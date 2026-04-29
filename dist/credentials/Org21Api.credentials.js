"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Org21Api = void 0;
class Org21Api {
    constructor() {
        this.name = 'org21Api';
        this.displayName = 'Org21 Legacy API';
        this.icon = 'file:org21.svg';
        this.documentationUrl = 'https://docs.n8n.io/api/authentication/';
        this.authenticate = {
            type: 'generic',
            properties: {
                headers: {
                    'X-N8N-API-KEY': '={{$credentials.apiKey}}',
                    'X-Org21-Source': 'formatter',
                },
            },
        };
        this.properties = [
            {
                displayName: 'Base URL',
                name: 'baseUrl',
                type: 'string',
                default: '',
                placeholder: 'https://your-n8n.example.com',
                description: 'Base URL of your n8n instance (no trailing slash)',
                required: true,
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
                required: true,
            },
        ];
        this.test = {
            request: {
                baseURL: '={{$credentials.baseUrl}}',
                url: '/api/v1/workflows',
                method: 'GET',
            },
        };
    }
}
exports.Org21Api = Org21Api;
//# sourceMappingURL=Org21Api.credentials.js.map