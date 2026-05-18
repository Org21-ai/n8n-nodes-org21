"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowSniffer = void 0;
const crypto_1 = require("crypto");
const n8n_workflow_1 = require("n8n-workflow");
async function postWithoutAuth(context, url, payload, headers) {
    await context.helpers.httpRequest({
        method: 'POST',
        url,
        body: payload,
        headers,
        json: true,
    });
}
function otlpAttr(key, value) {
    if (value === null || value === undefined)
        return { key, value: { stringValue: '' } };
    if (typeof value === 'string')
        return { key, value: { stringValue: value } };
    if (typeof value === 'boolean')
        return { key, value: { boolValue: value } };
    if (typeof value === 'number') {
        return Number.isInteger(value)
            ? { key, value: { intValue: String(value) } }
            : { key, value: { doubleValue: value } };
    }
    return { key, value: { stringValue: JSON.stringify(value) } };
}
function buildOtlpPayload(context, signal, payload, startTimeMs) {
    var _a, _b;
    const nowNs = (Date.now() * 1000000).toString();
    const startNs = (startTimeMs * 1000000).toString();
    const workflow = context.getWorkflow();
    const nodeName = context.getNode().name;
    const executionId = context.getExecutionId();
    const resourceAttrs = [
        otlpAttr('source', 'n8n'),
        otlpAttr('service.name', 'n8n'),
        otlpAttr('telemetry.sdk.name', 'n8n-nodes-org21'),
    ];
    const recordAttrs = [
        otlpAttr('workflow.id', (_a = workflow.id) !== null && _a !== void 0 ? _a : ''),
        otlpAttr('workflow.name', (_b = workflow.name) !== null && _b !== void 0 ? _b : ''),
        otlpAttr('execution.id', executionId),
        otlpAttr('node.name', nodeName),
    ];
    if (payload.timing && typeof payload.timing === 'object') {
        const t = payload.timing;
        if (typeof t.inputItemCount === 'number') {
            recordAttrs.push(otlpAttr('item.count', t.inputItemCount));
        }
    }
    const hasErrors = Array.isArray(payload.errors) && payload.errors.length > 0;
    if (hasErrors) {
        recordAttrs.push(otlpAttr('error.count', payload.errors.length));
    }
    const bodyStr = JSON.stringify(payload);
    if (signal === 'traces') {
        const traceId = (0, crypto_1.randomBytes)(16).toString('hex');
        const spanId = (0, crypto_1.randomBytes)(8).toString('hex');
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
                                    kind: 1,
                                    startTimeUnixNano: startNs,
                                    endTimeUnixNano: nowNs,
                                    attributes: [...recordAttrs, otlpAttr('payload', bodyStr)],
                                    status: { code: hasErrors ? 2 : 0 },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
    }
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
                                severityNumber: hasErrors ? 17 : 9,
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
class FlowSniffer {
    constructor() {
        this.description = {
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
            inputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            usableAsTool: {
                replacements: {
                    displayName: 'Org21-Observer-for-AI-agent-node',
                    description: 'Trigger an Org21 sub-workflow and capture its metadata, logs, timing, and errors. Use when an agent needs to invoke another n8n workflow and inspect the result.',
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
                    ],
                    default: 'none',
                    description: 'How to authenticate the outbound sub-flow request',
                },
                {
                    displayName: 'N8n API Key authentication is no longer offered for new workflows. This existing config still runs, but please migrate by switching Authentication to Keycloak (OAuth2). See the README for migration steps.',
                    name: 'apiKeyDeprecationNotice',
                    type: 'notice',
                    default: '',
                    displayOptions: {
                        show: {
                            authMethod: ['apiKey'],
                        },
                    },
                },
                {
                    displayName: 'Trigger Mode',
                    name: 'triggerMode',
                    type: 'options',
                    options: [
                        {
                            name: 'OTLP Export',
                            value: 'otlp',
                            description: 'Export sniffed data to the Org21 OTLP collector (OTLP/HTTP+JSON). Requires Keycloak (OAuth2) authentication.',
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
                {
                    displayName: 'OTLP Export requires Keycloak (OAuth2) authentication. Set Authentication above to "Keycloak (OAuth2)" — the collector validates the JWT and derives tenant_id from it.',
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
                {
                    displayName: 'Org21 OTLP Endpoint',
                    name: 'otlpEndpoint',
                    type: 'string',
                    default: 'https://otel.org21.ai',
                    required: true,
                    placeholder: 'https://otel.org21.ai',
                    description: 'Base URL of the Org21 OTLP collector. The signal-specific path (/v1/logs or /v1/traces) is appended automatically. Override only for BYOC deployments.',
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
                {
                    displayName: 'N8n API trigger mode is no longer offered for new workflows. This existing config still runs, but please migrate by switching Trigger Mode to Webhook POST. See the README for migration steps.',
                    name: 'n8nApiDeprecationNotice',
                    type: 'notice',
                    default: '',
                    displayOptions: {
                        show: {
                            triggerMode: ['n8nApi'],
                        },
                    },
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
        var _a, _b, _c, _d;
        const items = this.getInputData();
        const startTime = Date.now();
        const authMethod = this.getNodeParameter('authMethod', 0, 'none');
        const triggerMode = this.getNodeParameter('triggerMode', 0);
        const includeMetadata = this.getNodeParameter('includeMetadata', 0);
        const includeItemData = this.getNodeParameter('includeItemData', 0);
        const includeTiming = this.getNodeParameter('includeTiming', 0);
        const includeErrors = this.getNodeParameter('includeErrors', 0);
        const passThrough = this.getNodeParameter('passThrough', 0);
        const additionalHeaders = this.getNodeParameter('additionalHeaders', 0, {});
        const customFields = this.getNodeParameter('customFields', 0, {});
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
        const fieldEntries = (_a = customFields.field) !== null && _a !== void 0 ? _a : [];
        if (fieldEntries.length > 0) {
            const custom = {};
            for (const f of fieldEntries) {
                const name = f.name;
                if (!name)
                    continue;
                const fieldType = f.fieldType;
                const rawValue = f.value;
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
                        }
                        catch {
                            custom[name] = rawValue;
                        }
                        break;
                    case 'binary': {
                        const binaryData = (_c = (_b = items[0]) === null || _b === void 0 ? void 0 : _b.binary) === null || _c === void 0 ? void 0 : _c[rawValue];
                        if (binaryData) {
                            custom[name] = {
                                fileName: binaryData.fileName,
                                mimeType: binaryData.mimeType,
                                fileSize: binaryData.fileSize,
                                data: binaryData.data,
                            };
                        }
                        else {
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
        const headers = {
            'Content-Type': 'application/json',
            'X-Org21-Source': 'formatter',
        };
        const headerEntries = (_d = additionalHeaders.header) !== null && _d !== void 0 ? _d : [];
        for (const h of headerEntries) {
            if (h.name && h.value) {
                headers[h.name] = h.value;
            }
        }
        const credentialName = authMethod === 'keycloak' ? 'org21KeycloakOAuth2Api'
            : authMethod === 'apiKey' ? 'org21Api'
                : null;
        try {
            if (triggerMode === 'otlp') {
                if (authMethod !== 'keycloak') {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'OTLP Export requires Keycloak (OAuth2) authentication. Set Authentication to "Keycloak (OAuth2)" — the Org21 collector validates the JWT to attribute the tenant.');
                }
                const otlpEndpoint = (this.getNodeParameter('otlpEndpoint', 0) || '').replace(/\/+$/, '');
                const otlpSignal = this.getNodeParameter('otlpSignal', 0) || 'logs';
                if (!otlpEndpoint) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Org21 OTLP Endpoint is required');
                }
                const otlpUrl = `${otlpEndpoint}/v1/${otlpSignal}`;
                const otlpBody = buildOtlpPayload(this, otlpSignal, payload, startTime);
                await this.helpers.httpRequestWithAuthentication.call(this, 'org21KeycloakOAuth2Api', {
                    method: 'POST',
                    url: otlpUrl,
                    body: otlpBody,
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    json: true,
                });
            }
            else if (triggerMode === 'webhook') {
                const webhookUrl = this.getNodeParameter('webhookUrl', 0);
                if (!webhookUrl) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Webhook URL is required');
                }
                if (credentialName) {
                    await this.helpers.httpRequestWithAuthentication.call(this, credentialName, {
                        method: 'POST',
                        url: webhookUrl,
                        body: payload,
                        headers,
                        json: true,
                    });
                }
                else {
                    await postWithoutAuth(this, webhookUrl, payload, headers);
                }
            }
            else {
                const workflowId = this.getNodeParameter('workflowId', 0);
                if (!workflowId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Workflow ID is required');
                }
                if (authMethod !== 'apiKey') {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'n8n API mode requires API Key authentication. Use Webhook mode for Keycloak auth.');
                }
                const apiCredentials = await this.getCredentials('org21Api');
                const baseUrl = (apiCredentials.baseUrl || '').replace(/\/+$/, '');
                if (!baseUrl) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Base URL is required for API Key auth');
                }
                const apiUrl = `${baseUrl}/api/v1/workflows/${workflowId}/run`;
                await this.helpers.httpRequestWithAuthentication.call(this, 'org21Api', {
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
            if (error instanceof n8n_workflow_1.NodeOperationError || error instanceof n8n_workflow_1.NodeApiError) {
                throw error;
            }
            throw new n8n_workflow_1.NodeApiError(this.getNode(), error);
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