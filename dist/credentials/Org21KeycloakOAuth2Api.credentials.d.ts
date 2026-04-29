import type { ICredentialType, INodeProperties } from 'n8n-workflow';
export declare class Org21KeycloakOAuth2Api implements ICredentialType {
    name: string;
    extends: string[];
    displayName: string;
    icon: "file:org21.svg";
    documentationUrl: string;
    properties: INodeProperties[];
}
