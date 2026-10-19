import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ScrapelyApi implements ICredentialType {
	name = 'scrapelyApi';

	displayName = 'Scrapely API';

	icon: Icon = { light: 'file:../icons/scrapely.svg', dark: 'file:../icons/scrapely.svg' };

	documentationUrl = 'https://scrape.ly/docs/integrations';

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your Scrape.ly API token, from Settings → API & Integrations',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.scrape.ly',
			description: 'Only change this if you were given a different API address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/v2/users/me',
		},
	};
}
