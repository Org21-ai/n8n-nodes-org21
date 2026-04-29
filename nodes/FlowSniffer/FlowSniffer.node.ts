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

export class Formatter implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Org21-Observer',
		name: 'flowSniffer',
		icon: 'file:org21.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["triggerMode"] === "webhook" ? "Webhook" : "API → Workflow " + $parameter["workflowId"]}}',
		description: 'Sniff workflow metadata, logs, timing, and errors, then trigger a sub-flow via webhook or n8n API',
		defaults: {
			name: 'Org21-Observer',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
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
						name: 'Keycloak (OAuth2)',
						value: 'keycloak',
						description: 'Authenticate via Keycloak client credentials (per-workflow key from Key Service)',
					},
					{
						name: 'N8n API Key (Legacy)',
						value: 'apiKey',
						description: 'Authenticate via n8n API key',
					},
				],
				default: 'none',
				description: 'How to authenticate the outbound sub-flow request',
			},

			// ── Trigger mode ────────────────────────────────────────────────────
			{
				displayName: 'Trigger Mode',
				name: 'triggerMode',
				type: 'options',
				options: [
					{
						name: 'Webhook POST',
						value: 'webhook',
						description: 'POST sniffed data to a sub-flow webhook URL',
					},
					{
						name: 'N8n API',
						value: 'n8nApi',
						description: 'Trigger a workflow execution via n8n internal API (requires API Key auth)',
					},
				],
				default: 'webhook',
				description: 'How to trigger the sub-flow',
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
			if (triggerMode === 'webhook') {
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
						'n8n API mode requires API Key authentication. Use Webhook mode for Keycloak auth.',
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
