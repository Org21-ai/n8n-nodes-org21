"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Org21KeycloakOAuth2Api = void 0;
class Org21KeycloakOAuth2Api {
    constructor() {
        this.name = 'org21KeycloakOAuth2Api';
        this.extends = ['oAuth2Api'];
        this.displayName = 'Org21 Keycloak OAuth2 API';
        this.icon = 'file:org21.svg';
        this.documentationUrl = 'https://docs.n8n.io/integrations/builtin/credentials/oauth2/';
        this.properties = [
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
                default: '={{$self["keycloakUrl"].replace(/\\/+$/, "") + "/realms/" + $self["keycloakRealm"] + "/protocol/openid-connect/token"}}',
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
                displayName: 'Additional Body Properties',
                name: 'additionalBodyProperties',
                type: 'hidden',
                default: '{"audience":"api otel"}',
            },
        ];
    }
}
exports.Org21KeycloakOAuth2Api = Org21KeycloakOAuth2Api;
//# sourceMappingURL=Org21KeycloakOAuth2Api.credentials.js.map