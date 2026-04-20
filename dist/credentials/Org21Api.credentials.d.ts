import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';
export declare class Org21Api implements ICredentialType {
    name: string;
    displayName: string;
    icon: "file:org21.svg";
    documentationUrl: string;
    authenticate: IAuthenticateGeneric;
    properties: INodeProperties[];
    test: ICredentialTestRequest;
}
