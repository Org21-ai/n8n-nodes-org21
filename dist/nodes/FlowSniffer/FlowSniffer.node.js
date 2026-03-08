"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowSniffer = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const TOKEN_REFRESH_BUFFER_MS = 60000;
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000;
async function exchangeKeycloakToken(context, keycloakUrl, realm, clientId, clientSecret) {
    const tokenUrl = `${keycloakUrl.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/token`;
    const response = await context.helpers.httpRequest({
        method: 'POST',
        url: tokenUrl,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            audience: 'api otel',
        }).toString(),
    });
    const expiresIn = response.expires_in || (DEFAULT_TOKEN_TTL_MS / 1000);
    return {
        accessToken: response.access_token,
        expiresInMs: expiresIn * 1000,
    };
}
async function getCachedKeycloakToken(context, keycloakUrl, realm, clientId, clientSecret) {
    const staticData = context.getWorkflowStaticData('node');
    const now = Date.now();
    if (staticData.accessToken &&
        typeof staticData.tokenExpiresAt === 'number' &&
        staticData.tokenExpiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
        return staticData.accessToken;
    }
    const { accessToken, expiresInMs } = await exchangeKeycloakToken(context, keycloakUrl, realm, clientId, clientSecret);
    staticData.accessToken = accessToken;
    staticData.tokenExpiresAt = now + expiresInMs;
    return accessToken;
}
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
        let credentials;
        try {
            credentials = await this.getCredentials('org21Api');
        }
        catch {
        }
        if (credentials) {
            const authMethod = credentials.authMethod || 'apiKey';
            if (authMethod === 'keycloak') {
                const keycloakUrl = credentials.keycloakUrl;
                const realm = credentials.keycloakRealm || 'org21';
                const clientId = credentials.keycloakClientId;
                const clientSecret = credentials.keycloakClientSecret;
                if (!keycloakUrl || !clientId || !clientSecret) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Keycloak credentials incomplete: URL, Client ID, and Client Secret are required');
                }
                const token = await getCachedKeycloakToken(this, keycloakUrl, realm, clientId, clientSecret);
                headers['Authorization'] = `Bearer ${token}`;
            }
            else {
                if (credentials.apiKey) {
                    headers['X-N8N-API-KEY'] = credentials.apiKey;
                }
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
                if (!workflowId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Workflow ID is required');
                }
                if (!credentials) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Credentials are required for n8n API mode');
                }
                const authMethod = credentials.authMethod || 'apiKey';
                let apiUrl;
                if (authMethod === 'apiKey') {
                    const baseUrl = (credentials.baseUrl || '').replace(/\/+$/, '');
                    if (!baseUrl) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Base URL is required for API Key auth');
                    }
                    apiUrl = `${baseUrl}/api/v1/workflows/${workflowId}/run`;
                }
                else {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Keycloak auth is designed for Webhook mode. For n8n API mode, use API Key auth.');
                }
                await this.helpers.httpRequest({
                    method: 'POST',
                    url: apiUrl,
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