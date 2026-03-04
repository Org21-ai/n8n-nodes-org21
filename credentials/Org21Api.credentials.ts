import type {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class Org21Api implements ICredentialType {
	name = 'org21Api';
	displayName = 'Org21 API';
	icon = 'file:org21.svg' as const;
	documentationUrl = 'https://docs.n8n.io/api/authentication/';
	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://your-n8n.example.com',
			description: 'Base URL of your n8n instance (no trailing slash)',
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
		},
	];
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/workflows',
			method: 'GET',
			headers: {
				'X-N8N-API-KEY': '={{$credentials.apiKey}}',
			},
		},
	};
}
