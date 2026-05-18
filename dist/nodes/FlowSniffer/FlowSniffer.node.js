"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Formatter = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const TOKEN_REFRESH_BUFFER_MS = 60000;
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000;
async function exchangeAuthToken(context, authUrl, realm, clientId, clientSecret) {
    const tokenUrl = `${authUrl.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/token`;
    const response = await context.helpers.httpRequest({
        method: 'POST',
        url: tokenUrl,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
        },
    });
    const expiresIn = response.expires_in || (DEFAULT_TOKEN_TTL_MS / 1000);
    return {
        accessToken: response.access_token,
        expiresInMs: expiresIn * 1000,
    };
}
async function getCachedAuthToken(context, authUrl, realm, clientId, clientSecret) {
    const staticData = context.getWorkflowStaticData('node');
    const now = Date.now();
    if (staticData.accessToken &&
        typeof staticData.tokenExpiresAt === 'number' &&
        staticData.tokenExpiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
        return staticData.accessToken;
    }
    const { accessToken, expiresInMs } = await exchangeAuthToken(context, authUrl, realm, clientId, clientSecret);
    staticData.accessToken = accessToken;
    staticData.tokenExpiresAt = now + expiresInMs;
    return accessToken;
}
function otlpAttr(key, value) {
    if (value === null || value === undefined) {
        return { key, value: { stringValue: '' } };
    }
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
        if (typeof t.inputItemCount === 'number')
            recordAttrs.push(otlpAttr('item.count', t.inputItemCount));
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        recordAttrs.push(otlpAttr('error.count', payload.errors.length));
    }
    const bodyStr = JSON.stringify(payload);
    if (signal === 'traces') {
        const traceId = randomHex(16);
        const spanId = randomHex(8);
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
                                    status: { code: 0 },
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
                                severityNumber: Array.isArray(payload.errors) && payload.errors.length > 0 ? 17 : 9,
                                severityText: Array.isArray(payload.errors) && payload.errors.length > 0 ? 'ERROR' : 'INFO',
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
function randomHex(byteLen) {
    let out = '';
    for (let i = 0; i < byteLen * 2; i++)
        out += Math.floor(Math.random() * 16).toString(16);
    return out;
}
class Formatter {
    constructor() {
        this.description = {
            displayName: 'Org21-Observer',
            name: 'flowSniffer',
            icon: 'file:org21.svg',
            group: ['transform'],
            version: 1,
            subtitle: '={{$parameter["triggerMode"] === "otlp" ? "OTLP " + ($parameter["otlpSignal"] || "logs") : "API → Workflow " + $parameter["workflowId"]}}',
            description: 'Sniff workflow metadata, logs, timing, and errors. Export to the Org21 OTLP collector or trigger an n8n sub-flow via the n8n API.',
            defaults: {
                name: 'Org21-Observer',
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
                            name: 'OTLP Export',
                            value: 'otlp',
                            description: 'Export sniffed data to the Org21 OTLP collector (OTLP/HTTP+JSON)',
                        },
                        {
                            name: 'N8n API',
                            value: 'n8nApi',
                            description: 'Trigger a workflow execution via n8n internal API',
                        },
                    ],
                    default: 'otlp',
                    description: 'Where to send the sniffed payload',
                },
                {
                    displayName: 'Org21 OTLP Endpoint',
                    name: 'otlpEndpoint',
                    type: 'string',
                    default: 'https://otel.org21.ai',
                    required: true,
                    placeholder: 'https://otel.org21.ai',
                    description: 'Base URL of the Org21 OTLP collector. The signal-specific path (/v1/logs or /v1/traces) is appended automatically. BYOC deployments override this with their own collector URL.',
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
                            description: 'Emit one OTLP log record per execution (recommended for events)',
                        },
                        {
                            name: 'Traces',
                            value: 'traces',
                            description: 'Emit one OTLP span per execution (recommended for timing)',
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
        let credentials;
        try {
            credentials = await this.getCredentials('org21Api');
        }
        catch (error) {
            const msg = error.message || '';
            if (!msg.includes('No credentials') && !msg.includes('not configured') && !msg.includes('does not have')) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, {
                    message: `Unexpected error loading credentials: ${msg}`,
                });
            }
        }
        if (credentials) {
            const authMethod = credentials.authMethod || 'apiKey';
            if (authMethod === 'keycloak') {
                const authUrl = credentials.keycloakUrl;
                const realm = credentials.keycloakRealm || 'global-customers';
                const clientId = credentials.keycloakClientId;
                const clientSecret = credentials.keycloakClientSecret;
                if (!authUrl || !clientId || !clientSecret) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Service-key credentials incomplete: Auth URL, Client ID, and Client Secret are required');
                }
                const token = await getCachedAuthToken(this, authUrl, realm, clientId, clientSecret);
                headers['Authorization'] = `Bearer ${token}`;
            }
            else {
                if (credentials.apiKey) {
                    headers['X-N8N-API-KEY'] = credentials.apiKey;
                }
            }
        }
        try {
            if (triggerMode === 'otlp') {
                const otlpEndpoint = (this.getNodeParameter('otlpEndpoint', 0) || '').replace(/\/+$/, '');
                const otlpSignal = this.getNodeParameter('otlpSignal', 0) || 'logs';
                if (!otlpEndpoint) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Org21 OTLP Endpoint is required');
                }
                if (!credentials) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Credentials are required for OTLP export (use the Org21 Service Key auth method).');
                }
                if (credentials.authMethod !== 'keycloak') {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'OTLP export requires service-key auth. Set the credential’s Auth Method to "Org21 Service Key".');
                }
                const otlpUrl = `${otlpEndpoint}/v1/${otlpSignal}`;
                const otlpBody = buildOtlpPayload(this, otlpSignal, payload, startTime);
                await this.helpers.httpRequest({
                    method: 'POST',
                    url: otlpUrl,
                    body: otlpBody,
                    headers: { ...headers, 'Content-Type': 'application/json' },
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
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Org21 Service Key auth is for OTLP export. For n8n API mode, switch the credential to API Key (Legacy).');
                }
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
exports.Formatter = Formatter;
//# sourceMappingURL=FlowSniffer.node.js.map