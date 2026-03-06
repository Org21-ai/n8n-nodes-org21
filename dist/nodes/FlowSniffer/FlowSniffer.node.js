"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowSniffer = void 0;
const n8n_workflow_1 = require("n8n-workflow");
class FlowSniffer {
    constructor() {
        this.description = {
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
            inputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
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
                {
                    displayName: 'Pass Through',
                    name: 'passThrough',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to return original items (flow continues as normal) or return the sniffed payload instead',
                },
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
    }
    async execute() {
        var _a;
        const items = this.getInputData();
        const startTime = Date.now();
        const triggerMode = this.getNodeParameter('triggerMode', 0);
        const includeMetadata = this.getNodeParameter('includeMetadata', 0);
        const includeItemData = this.getNodeParameter('includeItemData', 0);
        const includeTiming = this.getNodeParameter('includeTiming', 0);
        const includeErrors = this.getNodeParameter('includeErrors', 0);
        const passThrough = this.getNodeParameter('passThrough', 0);
        const additionalHeaders = this.getNodeParameter('additionalHeaders', 0, {});
        const payload = {};
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
        const headers = {
            'Content-Type': 'application/json',
            'X-Org21-Source': 'flow-sniffer',
        };
        const headerEntries = (_a = additionalHeaders.header) !== null && _a !== void 0 ? _a : [];
        for (const h of headerEntries) {
            if (h.name && h.value) {
                headers[h.name] = h.value;
            }
        }
        try {
            if (triggerMode === 'webhook') {
                const webhookUrl = this.getNodeParameter('webhookUrl', 0);
                if (!webhookUrl) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Webhook URL is required');
                }
                await this.helpers.httpRequest({
                    method: 'POST',
                    url: webhookUrl,
                    body: payload,
                    headers,
                    json: true,
                });
            }
            else {
                const workflowId = this.getNodeParameter('workflowId', 0);
                const credentials = await this.getCredentials('org21Api');
                const baseUrl = credentials.baseUrl.replace(/\/+$/, '');
                const apiKey = credentials.apiKey;
                if (!workflowId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Workflow ID is required');
                }
                headers['X-N8N-API-KEY'] = apiKey;
                await this.helpers.httpRequest({
                    method: 'POST',
                    url: `${baseUrl}/api/v1/workflows/${workflowId}/run`,
                    body: payload,
                    headers,
                    json: true,
                });
            }
        }
        catch (error) {
            if (this.continueOnFail()) {
                return [[{ json: { error: error.message, payload }, pairedItem: 0 }]];
            }
            if (error instanceof n8n_workflow_1.NodeOperationError) {
                throw error;
            }
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, {
                message: `Failed to trigger sub-flow: ${error.message}`,
            });
        }
        if (includeTiming && payload.timing) {
            payload.timing.triggerDurationMs = Date.now() - startTime;
        }
        if (passThrough) {
            return [items];
        }
        return [[{ json: payload }]];
    }
}
exports.FlowSniffer = FlowSniffer;
//# sourceMappingURL=FlowSniffer.node.js.map