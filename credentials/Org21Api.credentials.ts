import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class Org21Api implements ICredentialType {
	name = 'org21Api';
	displayName = 'Org21 API';
	icon = 'file:org21.svg' as const;
	documentationUrl = 'https://docs.n8n.io/api/authentication/';
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-N8N-API-KEY': '={{$credentials.authMethod === "apiKey" ? $credentials.apiKey : ""}}',
				'X-Org21-Source': 'formatter',
			},
		},
	};
	properties: INodeProperties[] = [
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
		// ── Keycloak fields ────────────────────────────────────────────────
		{
			displayName: 'Keycloak URL',
			name: 'keycloakUrl',
			type: 'string',
			default: '',
			placeholder: 'https://keycloak.org21.ai',
			description: 'Base URL of the Keycloak server',
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
			default: 'org21',
			description: 'Keycloak realm name',
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
			placeholder: 'sa-acme-corp__my-workflow',
			description: 'Client ID from Key Service (per-workflow key)',
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
		// ── Legacy API Key fields ──────────────────────────────────────────
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
	test: ICredentialTestRequest = {
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
