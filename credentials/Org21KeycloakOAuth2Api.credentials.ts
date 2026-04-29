import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class Org21KeycloakOAuth2Api implements ICredentialType {
	name = 'org21KeycloakOAuth2Api';
	extends = ['oAuth2Api'];
	displayName = 'Org21 Keycloak OAuth2 API';
	icon = 'file:org21.svg' as const;
	documentationUrl = 'https://docs.n8n.io/integrations/builtin/credentials/oauth2/';

	properties: INodeProperties[] = [
		{
			displayName: 'Keycloak URL',
			name: 'keycloakUrl',
			type: 'string',
			default: '',
			placeholder: 'https://keycloak.org21.ai',
			required: true,
			description: 'Base URL of the Keycloak server',
		},
		{
			displayName: 'Realm',
			name: 'keycloakRealm',
			type: 'string',
			default: 'org21',
			required: true,
			description: 'Keycloak realm name',
		},
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'clientCredentials',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default:
				'={{$self["keycloakUrl"].replace(/\\/+$/, "") + "/realms/" + $self["keycloakRealm"] + "/protocol/openid-connect/token"}}',
			required: true,
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
		{
			displayName: 'Send Additional Body Properties',
			name: 'sendAdditionalBodyProperties',
			type: 'hidden',
			default: true,
		},
		{
			// Keycloak's client_credentials grant accepts `audience` as an extra body
			// param to scope the issued JWT to specific audiences (here: api + otel).
			displayName: 'Additional Body Properties',
			name: 'additionalBodyProperties',
			type: 'hidden',
			default: '{"audience":"api otel"}',
		},
	];
}
