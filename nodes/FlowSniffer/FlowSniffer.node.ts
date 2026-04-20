import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestMethods,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

/** Buffer before token expiry to trigger refresh (60 seconds). */
const TOKEN_REFRESH_BUFFER_MS = 60_000;

/** Default token TTL if not returned by Keycloak (30 minutes). */
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Exchange Keycloak client credentials for a JWT access token.
 * Audiences: api, otel (hardcoded per design).
 */
async function exchangeKeycloakToken(
	context: IExecuteFunctions,
	keycloakUrl: string,
	realm: string,
	clientId: string,
	clientSecret: string,
): Promise<{ accessToken: string; expiresInMs: number }> {
	const tokenUrl = `${keycloakUrl.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/token`;

	const response = await context.helpers.httpRequest({
		method: 'POST' as IHttpRequestMethods,
		url: tokenUrl,
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: clientId,
			client_secret: clientSecret,
			audience: 'api otel',
		}).toString(),
	});

	const expiresIn = (response.expires_in as number) || (DEFAULT_TOKEN_TTL_MS / 1000);

	return {
		accessToken: response.access_token as string,
		expiresInMs: expiresIn * 1000,
	};
}

/**
 * Get a cached Keycloak JWT or exchange credentials for a fresh one.
 * Uses n8n's getWorkflowStaticData() to persist the token between executions.
 */
async function getCachedKeycloakToken(
	context: IExecuteFunctions,
	keycloakUrl: string,
	realm: string,
	clientId: string,
	clientSecret: string,
): Promise<string> {
	const staticData = context.getWorkflowStaticData('node');
	const now = Date.now();

	// Reuse cached token if still valid (with buffer before expiry)
	if (
		staticData.accessToken &&
		typeof staticData.tokenExpiresAt === 'number' &&
		staticData.tokenExpiresAt > now + TOKEN_REFRESH_BUFFER_MS
	) {
		return staticData.accessToken as string;
	}

	// Token missing or expired — exchange for a new one
	const { accessToken, expiresInMs } = await exchangeKeycloakToken(
		context,
		keycloakUrl,
		realm,
		clientId,
		clientSecret,
	);

	staticData.accessToken = accessToken;
	staticData.tokenExpiresAt = now + expiresInMs;

	return accessToken;
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
				name: 'org21Api',
				required: false,
			},
		],
		properties: [
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
						description: 'Trigger a workflow execution via n8n internal API',
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

		// ── Resolve auth (Keycloak Bearer or legacy API key) ────────────────
		let credentials: IDataObject | undefined;
		try {
			credentials = await this.getCredentials('org21Api') as IDataObject;
		} catch (error) {
			// Only ignore "credentials not configured" — re-throw unexpected errors
			const msg = (error as Error).message || '';
			if (!msg.includes('No credentials') && !msg.includes('not configured') && !msg.includes('does not have')) {
				throw new NodeOperationError(this.getNode(), error as Error, {
					message: `Unexpected error loading credentials: ${msg}`,
				});
			}
		}

		if (credentials) {
			const authMethod = (credentials.authMethod as string) || 'apiKey';

			if (authMethod === 'keycloak') {
				const keycloakUrl = credentials.keycloakUrl as string;
				const realm = (credentials.keycloakRealm as string) || 'org21';
				const clientId = credentials.keycloakClientId as string;
				const clientSecret = credentials.keycloakClientSecret as string;

				if (!keycloakUrl || !clientId || !clientSecret) {
					throw new NodeOperationError(
						this.getNode(),
						'Keycloak credentials incomplete: URL, Client ID, and Client Secret are required',
					);
				}

				const token = await getCachedKeycloakToken(
					this,
					keycloakUrl,
					realm,
					clientId,
					clientSecret,
				);
				headers['Authorization'] = `Bearer ${token}`;
			} else {
				// Legacy API key mode
				if (credentials.apiKey) {
					headers['X-N8N-API-KEY'] = credentials.apiKey as string;
				}
			}
		}

		// ── Trigger sub-flow ────────────────────────────────────────────────
		try {
			if (triggerMode === 'webhook') {
				const webhookUrl = this.getNodeParameter('webhookUrl', 0) as string;
				if (!webhookUrl) {
					throw new NodeOperationError(this.getNode(), 'Webhook URL is required');
				}
				if (credentials) {
					await this.helpers.httpRequestWithAuthentication.call(this, 'org21Api', {
						method: 'POST' as IHttpRequestMethods,
						url: webhookUrl,
						body: payload,
						headers,
						json: true,
					});
				} else {
					await this.helpers.httpRequest({
						method: 'POST' as IHttpRequestMethods,
						url: webhookUrl,
						body: payload,
						headers,
						json: true,
					});
				}
			} else {
				// n8n API mode — requires credentials
				const workflowId = this.getNodeParameter('workflowId', 0) as string;
				if (!workflowId) {
					throw new NodeOperationError(this.getNode(), 'Workflow ID is required');
				}
				if (!credentials) {
					throw new NodeOperationError(this.getNode(), 'Credentials are required for n8n API mode');
				}

				const authMethod = (credentials.authMethod as string) || 'apiKey';
				let apiUrl: string;

				if (authMethod === 'apiKey') {
					const baseUrl = (credentials.baseUrl as string || '').replace(/\/+$/, '');
					if (!baseUrl) {
						throw new NodeOperationError(this.getNode(), 'Base URL is required for API Key auth');
					}
					apiUrl = `${baseUrl}/api/v1/workflows/${workflowId}/run`;
				} else {
					// Keycloak mode — n8n API URL must come from webhook URL or be configured elsewhere
					// In Keycloak mode the primary use case is webhook POST with Bearer token
					throw new NodeOperationError(
						this.getNode(),
						'Keycloak auth is designed for Webhook mode. For n8n API mode, use API Key auth.',
					);
				}

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
			if (error instanceof NodeOperationError) {
				throw error;
			}
			throw new NodeOperationError(this.getNode(), error as Error, {
				message: `Failed to trigger sub-flow: ${(error as Error).message}`,
			});
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
