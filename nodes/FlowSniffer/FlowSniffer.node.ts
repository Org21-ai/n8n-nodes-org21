import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestMethods,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

export class FlowSniffer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Org21 Flow Sniffer',
		name: 'flowSniffer',
		icon: 'file:../../icons/org21.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["triggerMode"] === "webhook" ? "Webhook" : "API → Workflow " + $parameter["workflowId"]}}',
		description: 'Sniff workflow metadata, logs, timing, and errors, then trigger a sub-flow via webhook or n8n API',
		defaults: {
			name: 'Flow Sniffer',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'org21Api',
				required: false,
				displayOptions: {
					show: {
						triggerMode: ['n8nApi'],
					},
				},
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

		// ── Build headers ───────────────────────────────────────────────────
		const headers: IDataObject = {
			'Content-Type': 'application/json',
			'X-Org21-Source': 'flow-sniffer',
		};
		const headerEntries = (additionalHeaders.header as IDataObject[] | undefined) ?? [];
		for (const h of headerEntries) {
			if (h.name && h.value) {
				headers[h.name as string] = h.value;
			}
		}

		// ── Trigger sub-flow ────────────────────────────────────────────────
		try {
			if (triggerMode === 'webhook') {
				const webhookUrl = this.getNodeParameter('webhookUrl', 0) as string;
				if (!webhookUrl) {
					throw new NodeOperationError(this.getNode(), 'Webhook URL is required');
				}
				await this.helpers.httpRequest({
					method: 'POST' as IHttpRequestMethods,
					url: webhookUrl,
					body: payload,
					headers,
					json: true,
				});
			} else {
				// n8n API mode — base URL + API key come from the credential
				const workflowId = this.getNodeParameter('workflowId', 0) as string;
				const credentials = await this.getCredentials('org21Api');
				const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');
				const apiKey = credentials.apiKey as string;

				if (!workflowId) {
					throw new NodeOperationError(this.getNode(), 'Workflow ID is required');
				}

				headers['X-N8N-API-KEY'] = apiKey;

				await this.helpers.httpRequest({
					method: 'POST' as IHttpRequestMethods,
					url: `${baseUrl}/api/v1/workflows/${workflowId}/run`,
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
