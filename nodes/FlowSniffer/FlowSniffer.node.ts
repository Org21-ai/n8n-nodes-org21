import { randomBytes } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

/**
 * Top-level helper for the no-auth path. Kept off the class on purpose: the
 * `no-http-request-with-manual-auth` lint rule scans per function, so isolating
 * the unauthenticated `httpRequest` call here keeps `execute` clean even when
 * it later fetches credentials for the authenticated branches.
 */
async function postWithoutAuth(
	context: IExecuteFunctions,
	url: string,
	payload: IDataObject,
	headers: IDataObject,
): Promise<void> {
	await context.helpers.httpRequest({
		method: 'POST' as IHttpRequestMethods,
		url,
		body: payload,
		headers,
		json: true,
	});
}

/**
 * Encode a key/value into the OTLP/JSON `AnyValue` shape.
 * Falls back to JSON-string for objects/arrays so the collector keeps a flat
 * `KeyValue` list and we avoid `kvlistValue` complexity.
 */
function otlpAttr(key: string, value: unknown): { key: string; value: IDataObject } {
	if (value === null || value === undefined) return { key, value: { stringValue: '' } };
	if (typeof value === 'string') return { key, value: { stringValue: value } };
	if (typeof value === 'boolean') return { key, value: { boolValue: value } };
	if (typeof value === 'number') {
		return Number.isInteger(value)
			? { key, value: { intValue: String(value) } }
			: { key, value: { doubleValue: value } };
	}
	return { key, value: { stringValue: JSON.stringify(value) } };
}

/**
 * Build an OTLP/JSON ExportLogsServiceRequest or ExportTraceServiceRequest body
 * for the Org21 metric-otel-collector (`/v1/logs` or `/v1/traces`,
 * `Content-Type: application/json`).
 *
 * tenant_id is NOT stamped: the collector derives it from the validated JWT
 * subject claim (the credential authenticates as a per-tenant service-account
 * client), so any caller-supplied tenant_id would be overwritten or rejected.
 * source=n8n on the resource lets dashboards filter by emitter.
 */
function buildOtlpPayload(
	context: IExecuteFunctions,
	signal: string,
	payload: IDataObject,
	startTimeMs: number,
): IDataObject {
	const nowNs = (Date.now() * 1_000_000).toString();
	const startNs = (startTimeMs * 1_000_000).toString();
	const workflow = context.getWorkflow();
	const nodeName = context.getNode().name;
	const executionId = context.getExecutionId();

	const resourceAttrs = [
		otlpAttr('source', 'n8n'),
		otlpAttr('service.name', 'n8n'),
		otlpAttr('telemetry.sdk.name', 'n8n-nodes-org21'),
	];

	const recordAttrs = [
		otlpAttr('workflow.id', workflow.id ?? ''),
		otlpAttr('workflow.name', workflow.name ?? ''),
		otlpAttr('execution.id', executionId),
		otlpAttr('node.name', nodeName),
	];
	if (payload.timing && typeof payload.timing === 'object') {
		const t = payload.timing as IDataObject;
		if (typeof t.inputItemCount === 'number') {
			recordAttrs.push(otlpAttr('item.count', t.inputItemCount));
		}
	}
	const hasErrors = Array.isArray(payload.errors) && payload.errors.length > 0;
	if (hasErrors) {
		recordAttrs.push(otlpAttr('error.count', (payload.errors as unknown[]).length));
	}

	const bodyStr = JSON.stringify(payload);

	if (signal === 'traces') {
		// 16-byte trace ID + 8-byte span ID per OTLP spec.
		const traceId = randomBytes(16).toString('hex');
		const spanId = randomBytes(8).toString('hex');
		return {
			resourceSpans: [
				{
					resource: { attributes: resourceAttrs },
					scopeSpans: [
						{
							scope: { name: 'n8n-nodes-org21.flowSniffer' },
							spans: [
								{
									traceId,
									spanId,
									name: `n8n.${nodeName}`,
									kind: 1, // SPAN_KIND_INTERNAL
									startTimeUnixNano: startNs,
									endTimeUnixNano: nowNs,
									attributes: [...recordAttrs, otlpAttr('payload', bodyStr)],
									status: { code: hasErrors ? 2 : 0 }, // ERROR : UNSET
								},
							],
						},
					],
				},
			],
		};
	}

	// Default: logs
	return {
		resourceLogs: [
			{
				resource: { attributes: resourceAttrs },
				scopeLogs: [
					{
						scope: { name: 'n8n-nodes-org21.flowSniffer' },
						logRecords: [
							{
								timeUnixNano: nowNs,
								observedTimeUnixNano: nowNs,
								severityNumber: hasErrors ? 17 : 9, // ERROR : INFO
								severityText: hasErrors ? 'ERROR' : 'INFO',
								body: { stringValue: bodyStr },
								attributes: recordAttrs,
							},
						],
					},
				],
			},
		],
	};
}

export class FlowSniffer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Org21-Observer',
		name: 'flowSniffer',
		icon: 'file:org21.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["triggerMode"] === "otlp" ? "OTLP " + ($parameter["otlpSignal"] || "logs") : $parameter["triggerMode"] === "webhook" ? "Webhook" : "API → Workflow " + $parameter["workflowId"]}}',
		description: 'Sniff workflow metadata, logs, timing, and errors. Export to the Org21 OTLP collector or trigger a sub-flow via webhook or n8n API.',
		documentationUrl: 'https://github.com/Org21-ai/n8n-nodes-org21#readme',
		defaults: {
			name: 'Org21-Observer',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: {
			replacements: {
				displayName: 'Org21-Observer-for-AI-agent-node',
				description:
					'Trigger an Org21 sub-workflow and capture its metadata, logs, timing, and errors. Use when an agent needs to invoke another n8n workflow and inspect the result.',
			},
		},
		credentials: [
			{
				name: 'org21KeycloakOAuth2Api',
				required: true,
				displayOptions: {
					show: {
						authMethod: ['keycloak'],
					},
				},
			},
			{
				name: 'org21Api',
				required: true,
				displayOptions: {
					show: {
						authMethod: ['apiKey'],
					},
				},
			},
		],
		properties: [
			// ── Authentication ──────────────────────────────────────────────────
			{
				displayName: 'Authentication',
				name: 'authMethod',
				type: 'options',
				options: [
					{
						name: 'None',
						value: 'none',
						description: 'Send the sub-flow request without authentication',
					},
					{
						name: 'Org21 OAuth2',
						// Stored value retained as 'keycloak' for backward compat
						// with existing saved workflows; do not rename (DEV-458).
						value: 'keycloak',
						description: 'Authenticate via Org21 service-key client credentials (per-workflow key from the Org21 tenant-manager UI)',
					},
				],
				default: 'none',
				description: 'How to authenticate the outbound sub-flow request',
			},

			// ── Deprecation notice (apiKey) ─────────────────────────────────────
			// The 'apiKey' value is no longer in the options array above, so new
			// users can't pick it. This notice only renders for existing workflows
			// whose saved authMethod is still 'apiKey', telling them how to migrate.
			// The execute() branch handling apiKey is retained for backward compat.
			{
				displayName:
					'N8n API Key authentication is no longer offered for new workflows. This existing config still runs, but please migrate by switching Authentication to Org21 OAuth2. See the README for migration steps.',
				name: 'apiKeyDeprecationNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						authMethod: ['apiKey'],
					},
				},
			},

			// ── Trigger mode ────────────────────────────────────────────────────
			{
				displayName: 'Trigger Mode',
				name: 'triggerMode',
				type: 'options',
				options: [
					{
						name: 'OTLP Export',
						value: 'otlp',
						description:
							'Export sniffed data to the Org21 OTLP collector (OTLP/HTTP+JSON). Requires Org21 OAuth2 authentication.',
					},
					{
						name: 'Webhook POST',
						value: 'webhook',
						description: 'POST sniffed data to a sub-flow webhook URL',
					},
				],
				default: 'webhook',
				description: 'Where to send the sniffed payload',
			},

			// ── OTLP-mode auth notice ───────────────────────────────────────────
			// OTLP export only works with the Org21 OAuth2 auth method — the
			// Org21 collector validates JWTs and derives tenant_id from the
			// subject claim. Surface this in-UI so the misconfig is caught
			// before run.
			{
				displayName:
					'OTLP Export requires Org21 OAuth2 authentication. Set Authentication above to "Org21 OAuth2" — the collector validates the JWT and derives tenant_id from it.',
				name: 'otlpAuthNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						triggerMode: ['otlp'],
						authMethod: ['none', 'apiKey'],
					},
				},
			},

			// ── OTLP settings ───────────────────────────────────────────────────
			{
				displayName: 'Org21 OTLP Endpoint',
				name: 'otlpEndpoint',
				type: 'string',
				default: 'https://otel.org21.ai',
				required: true,
				placeholder: 'https://otel.org21.ai',
				description:
					'Base URL of the Org21 OTLP collector. The signal-specific path (/v1/logs or /v1/traces) is appended automatically. Override only for BYOC deployments.',
				displayOptions: {
					show: {
						triggerMode: ['otlp'],
					},
				},
			},
			{
				displayName: 'OTLP Signal',
				name: 'otlpSignal',
				type: 'options',
				options: [
					{
						name: 'Logs',
						value: 'logs',
						description: 'Emit one OTLP log record per execution (recommended for event-shaped telemetry)',
					},
					{
						name: 'Traces',
						value: 'traces',
						description: 'Emit one OTLP span per execution (recommended for timing dashboards)',
					},
				],
				default: 'logs',
				description: 'Which OTLP signal type to export',
				displayOptions: {
					show: {
						triggerMode: ['otlp'],
					},
				},
			},

			// ── Deprecation notice (n8nApi) ─────────────────────────────────────
			// Same pattern: 'n8nApi' is no longer in the options array, so the
			// notice only renders for existing workflows whose saved triggerMode
			// is still 'n8nApi'.
			{
				displayName:
					'N8n API trigger mode is no longer offered for new workflows. This existing config still runs, but please migrate by switching Trigger Mode to Webhook POST. See the README for migration steps.',
				name: 'n8nApiDeprecationNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						triggerMode: ['n8nApi'],
					},
				},
			},

			// ── Webhook settings ────────────────────────────────────────────────
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://your-n8n.example.com/webhook/abc123',
				description: 'URL of the sub-flow webhook trigger to POST sniffed data to',
				displayOptions: {
					show: {
						triggerMode: ['webhook'],
					},
				},
			},

			// ── n8n API settings ────────────────────────────────────────────────
			{
				displayName: 'Workflow ID',
				name: 'workflowId',
				type: 'string',
				default: '',
				required: true,
				placeholder: '1234',
				description: 'ID of the sub-flow workflow to trigger',
				displayOptions: {
					show: {
						triggerMode: ['n8nApi'],
					},
				},
			},

			// ── Data toggles ────────────────────────────────────────────────────
			{
				displayName: 'Include Metadata',
				name: 'includeMetadata',
				type: 'boolean',
				default: true,
				description: 'Whether to include workflow ID, name, execution ID, node name, and timestamp',
			},
			{
				displayName: 'Include Item Data',
				name: 'includeItemData',
				type: 'boolean',
				default: true,
				description: 'Whether to include the actual JSON items passing through this node',
			},
			{
				displayName: 'Include Timing',
				name: 'includeTiming',
				type: 'boolean',
				default: true,
				description: 'Whether to include execution timing and item counts',
			},
			{
				displayName: 'Include Errors',
				name: 'includeErrors',
				type: 'boolean',
				default: true,
				description: 'Whether to include error information from items that have errors',
			},

			// ── Behaviour ───────────────────────────────────────────────────────
			{
				displayName: 'Pass Through',
				name: 'passThrough',
				type: 'boolean',
				default: true,
				description: 'Whether to return original items (flow continues as normal) or return the sniffed payload instead',
			},

			// ── Custom metadata fields ──────────────────────────────────────────
			{
				displayName: 'Custom Fields',
				name: 'customFields',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add Custom Field',
				description: 'Add custom key-value pairs to the payload metadata',
				options: [
					{
						name: 'field',
						displayName: 'Field',
						values: [
							{
								displayName: 'Field Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. environment',
								description: 'Name of the custom field',
							},
							{
								displayName: 'Field Type',
								name: 'fieldType',
								type: 'options',
								options: [
									{ name: 'Array (JSON)', value: 'array' },
									{ name: 'Binary Data', value: 'binary' },
									{ name: 'Boolean', value: 'boolean' },
									{ name: 'Number', value: 'number' },
									{ name: 'Object (JSON)', value: 'object' },
									{ name: 'String', value: 'string' },
								],
								default: 'string',
								description: 'Data type of the field value',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								placeholder: 'e.g. production',
								description: 'Value of the custom field (supports expressions). For Array/Object use JSON, for Boolean use true/false, for Binary use the binary property name.',
							},
						],
					},
				],
			},

			// ── Additional headers ──────────────────────────────────────────────
			{
				displayName: 'Additional Headers',
				name: 'additionalHeaders',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add Header',
				options: [
					{
						name: 'header',
						displayName: 'Header',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const startTime = Date.now();

		const authMethod = this.getNodeParameter('authMethod', 0, 'none') as string;
		const triggerMode = this.getNodeParameter('triggerMode', 0) as string;
		const includeMetadata = this.getNodeParameter('includeMetadata', 0) as boolean;
		const includeItemData = this.getNodeParameter('includeItemData', 0) as boolean;
		const includeTiming = this.getNodeParameter('includeTiming', 0) as boolean;
		const includeErrors = this.getNodeParameter('includeErrors', 0) as boolean;
		const passThrough = this.getNodeParameter('passThrough', 0) as boolean;
		const additionalHeaders = this.getNodeParameter('additionalHeaders', 0, {}) as IDataObject;
		const customFields = this.getNodeParameter('customFields', 0, {}) as IDataObject;

		// ── Build sniffed payload ───────────────────────────────────────────
		const payload: IDataObject = {};

		if (includeMetadata) {
			const workflow = this.getWorkflow();
			payload.metadata = {
				workflowId: workflow.id,
				workflowName: workflow.name,
				workflowActive: workflow.active,
				executionId: this.getExecutionId(),
				nodeName: this.getNode().name,
				nodeType: this.getNode().type,
				timestamp: new Date().toISOString(),
			};
		}

		if (includeItemData) {
			payload.items = items.map((item) => item.json);
		}

		if (includeTiming) {
			payload.timing = {
				sniffedAt: new Date().toISOString(),
				inputItemCount: items.length,
				executionStartMs: startTime,
			};
		}

		if (includeErrors) {
			const errors = items
				.filter((item) => item.error)
				.map((item, index) => ({
					itemIndex: index,
					error: item.error instanceof Error
						? { message: item.error.message, name: item.error.name }
						: item.error,
				}));
			if (errors.length > 0) {
				payload.errors = errors;
			}
		}

		// ── Custom fields ───────────────────────────────────────────────────
		const fieldEntries = (customFields.field as IDataObject[] | undefined) ?? [];
		if (fieldEntries.length > 0) {
			const custom: IDataObject = {};
			for (const f of fieldEntries) {
				const name = f.name as string;
				if (!name) continue;
				const fieldType = f.fieldType as string;
				const rawValue = f.value as string;

				switch (fieldType) {
					case 'number':
						custom[name] = Number(rawValue);
						break;
					case 'boolean':
						custom[name] = rawValue === 'true' || rawValue === '1';
						break;
					case 'array':
					case 'object':
						try {
							custom[name] = JSON.parse(rawValue);
						} catch {
							custom[name] = rawValue;
						}
						break;
					case 'binary': {
						const binaryData = items[0]?.binary?.[rawValue];
						if (binaryData) {
							custom[name] = {
								fileName: binaryData.fileName,
								mimeType: binaryData.mimeType,
								fileSize: binaryData.fileSize,
								data: binaryData.data,
							};
						} else {
							custom[name] = null;
						}
						break;
					}
					default:
						custom[name] = rawValue;
				}
			}
			payload.customFields = custom;
		}

		// ── Build headers ───────────────────────────────────────────────────
		const headers: IDataObject = {
			'Content-Type': 'application/json',
			'X-Org21-Source': 'formatter',
		};
		const headerEntries = (additionalHeaders.header as IDataObject[] | undefined) ?? [];
		for (const h of headerEntries) {
			if (h.name && h.value) {
				headers[h.name as string] = h.value;
			}
		}

		// ── Resolve credential name from selected auth method ───────────────
		const credentialName: string | null =
			authMethod === 'keycloak' ? 'org21KeycloakOAuth2Api'
				: authMethod === 'apiKey' ? 'org21Api'
					: null;

		// ── Trigger sub-flow ────────────────────────────────────────────────
		try {
			if (triggerMode === 'otlp') {
				if (authMethod !== 'keycloak') {
					throw new NodeOperationError(
						this.getNode(),
						'OTLP Export requires Org21 OAuth2 authentication. Set Authentication to "Org21 OAuth2" — the Org21 collector validates the JWT to attribute the tenant.',
					);
				}
				const otlpEndpoint = ((this.getNodeParameter('otlpEndpoint', 0) as string) || '').replace(
					/\/+$/,
					'',
				);
				const otlpSignal = (this.getNodeParameter('otlpSignal', 0) as string) || 'logs';
				if (!otlpEndpoint) {
					throw new NodeOperationError(this.getNode(), 'Org21 OTLP Endpoint is required');
				}
				const otlpUrl = `${otlpEndpoint}/v1/${otlpSignal}`;
				const otlpBody = buildOtlpPayload(this, otlpSignal, payload, startTime);

				await this.helpers.httpRequestWithAuthentication.call(this, 'org21KeycloakOAuth2Api', {
					method: 'POST' as IHttpRequestMethods,
					url: otlpUrl,
					body: otlpBody,
					headers: { ...headers, 'Content-Type': 'application/json' },
					json: true,
				});
			} else if (triggerMode === 'webhook') {
				const webhookUrl = this.getNodeParameter('webhookUrl', 0) as string;
				if (!webhookUrl) {
					throw new NodeOperationError(this.getNode(), 'Webhook URL is required');
				}
				if (credentialName) {
					await this.helpers.httpRequestWithAuthentication.call(this, credentialName, {
						method: 'POST' as IHttpRequestMethods,
						url: webhookUrl,
						body: payload,
						headers,
						json: true,
					});
				} else {
					await postWithoutAuth(this, webhookUrl, payload, headers);
				}
			} else {
				// n8n API mode — only meaningful with the legacy API key credential,
				// since it needs `baseUrl` from the credential to build the URL.
				const workflowId = this.getNodeParameter('workflowId', 0) as string;
				if (!workflowId) {
					throw new NodeOperationError(this.getNode(), 'Workflow ID is required');
				}
				if (authMethod !== 'apiKey') {
					throw new NodeOperationError(
						this.getNode(),
						'n8n API mode requires API Key authentication. Use Webhook mode for Org21 OAuth2 auth.',
					);
				}
				const apiCredentials = await this.getCredentials('org21Api');
				const baseUrl = ((apiCredentials.baseUrl as string) || '').replace(/\/+$/, '');
				if (!baseUrl) {
					throw new NodeOperationError(this.getNode(), 'Base URL is required for API Key auth');
				}
				const apiUrl = `${baseUrl}/api/v1/workflows/${workflowId}/run`;

				await this.helpers.httpRequestWithAuthentication.call(this, 'org21Api', {
					method: 'POST' as IHttpRequestMethods,
					url: apiUrl,
					body: payload,
					headers,
					json: true,
				});
			}
		} catch (error) {
			if (this.continueOnFail()) {
				return [[{ json: { error: (error as Error).message, payload }, pairedItem: 0 }]];
			}
			if (error instanceof NodeOperationError || error instanceof NodeApiError) {
				throw error;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject);
		}

		// ── Add timing post-send ────────────────────────────────────────────
		if (includeTiming && payload.timing) {
			(payload.timing as IDataObject).triggerDurationMs = Date.now() - startTime;
		}

		// ── Return ──────────────────────────────────────────────────────────
		if (passThrough) {
			return [items];
		}
		return [[{ json: payload as IDataObject }]];
	}
}
