"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Org21Api = void 0;
class Org21Api {
    constructor() {
        this.name = 'org21Api';
        this.displayName = 'Org21 API';
        this.icon = 'file:org21.svg';
        this.documentationUrl = 'https://docs.n8n.io/api/authentication/';
        this.authenticate = {
            type: 'generic',
            properties: {
                headers: {
                    'X-N8N-API-KEY': '={{$credentials.authMethod === "apiKey" ? $credentials.apiKey : ""}}',
                    'X-Org21-Source': 'formatter',
                },
            },
        };
        this.properties = [
            {
                displayName: 'Auth Method',
                name: 'authMethod',
                type: 'options',
                options: [
                    {
                        name: 'Keycloak Service Key',
                        value: 'keycloak',
                        description: 'Authenticate via Keycloak client credentials (per-workflow key from Key Service)',
                    },
                    {
                        name: 'API Key (Legacy)',
                        value: 'apiKey',
                        description: 'Authenticate via n8n API key',
                    },
                ],
                default: 'keycloak',
                description: 'Authentication method to use',
            },
            {
                displayName: 'Keycloak URL',
                name: 'keycloakUrl',
                type: 'string',
                default: 'https://auth.org21.ai',
                placeholder: 'https://auth.org21.ai',
                description: 'Base URL of the Keycloak server. BYOC deployments override with their own.',
                displayOptions: {
                    show: {
                        authMethod: ['keycloak'],
                    },
                },
            },
            {
                displayName: 'Realm',
                name: 'keycloakRealm',
                type: 'string',
                default: 'global-customers',
                description: 'Keycloak realm name. Customer-facing keys minted via the Org21 tenant-manager live in "global-customers".',
                displayOptions: {
                    show: {
                        authMethod: ['keycloak'],
                    },
                },
            },
            {
                displayName: 'Client ID',
                name: 'keycloakClientId',
                type: 'string',
                default: '',
                placeholder: 'acme-otel-n8n-1747494609000',
                description: 'Client ID of the per-tenant key minted via the Org21 tenant-manager UI ({tenant}-{name}; e.g. acme-otel-n8n-{ts}).',
                displayOptions: {
                    show: {
                        authMethod: ['keycloak'],
                    },
                },
            },
            {
                displayName: 'Client Secret',
                name: 'keycloakClientSecret',
                type: 'string',
                typeOptions: {
                    password: true,
                },
                default: '',
                description: 'Client secret from Key Service (shown once at key creation)',
                displayOptions: {
                    show: {
                        authMethod: ['keycloak'],
                    },
                },
            },
            {
                displayName: 'Base URL',
                name: 'baseUrl',
                type: 'string',
                default: '',
                placeholder: 'https://your-n8n.example.com',
                description: 'Base URL of your n8n instance (no trailing slash)',
                displayOptions: {
                    show: {
                        authMethod: ['apiKey'],
                    },
                },
            },
            {
                displayName: 'API Key',
                name: 'apiKey',
                type: 'string',
                typeOptions: {
                    password: true,
                },
                default: '',
                description: 'n8n API key for triggering workflows via the n8n REST API',
                displayOptions: {
                    show: {
                        authMethod: ['apiKey'],
                    },
                },
            },
        ];
        this.test = {
            request: {
                baseURL: '={{$credentials.authMethod === "apiKey" ? $credentials.baseUrl : $credentials.keycloakUrl}}',
                url: '={{$credentials.authMethod === "apiKey" ? "/api/v1/workflows" : "/realms/" + $credentials.keycloakRealm + "/.well-known/openid-configuration"}}',
                method: 'GET',
                headers: {
                    'X-N8N-API-KEY': '={{$credentials.authMethod === "apiKey" ? $credentials.apiKey : ""}}',
                },
            },
        };
    }
}
exports.Org21Api = Org21Api;
//# sourceMappingURL=Org21Api.credentials.js.map