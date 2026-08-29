import snapshot from './catalog.json';

export type ProviderProtocol = 'responses' | 'anthropic' | 'chat';

export interface ProviderModel {
	name: string;
	context_window?: number;
	max_output_tokens?: number;
	reasoning_efforts?: string[];
}

export interface CatalogProvider {
	id: string;
	name: string;
	description: string;
	base_url: string;
	protocol: ProviderProtocol;
	models: ProviderModel[];
	docs_url?: string;
	featured: boolean;
}

export interface ProviderCatalog {
	attribution: {
		source: string;
		repository: string;
		license: 'MIT';
		copyright: string;
		license_file: string;
		snapshot_date: string;
	};
	providers: CatalogProvider[];
}

export interface ProviderFormPrefill {
	id: string;
	base_url: string;
	format: ProviderProtocol;
	key: string;
	models: ProviderModel[];
}

const protocols = new Set<ProviderProtocol>(['responses', 'anthropic', 'chat']);
const text = (value: unknown, field: string): string => {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid provider catalog ${field}`);
	return value.trim();
};
const positiveInt = (value: unknown, field: string): number | undefined => {
	if (value == null) return undefined;
	if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`Invalid provider catalog ${field}`);
	return Number(value);
};

export function parseProviderCatalog(value: unknown): ProviderCatalog {
	if (!value || typeof value !== 'object') throw new Error('Invalid provider catalog root');
	const root = value as Record<string, unknown>;
	const rawAttribution = root._attribution;
	if (!rawAttribution || typeof rawAttribution !== 'object') {
		throw new Error('Provider catalog attribution is missing');
	}
	const attributionValue = rawAttribution as Record<string, unknown>;
	const license = text(attributionValue.license, 'license');
	if (license !== 'MIT') throw new Error(`Unsupported provider catalog license: ${license}`);
	const attribution: ProviderCatalog['attribution'] = {
		source: text(attributionValue.source, 'source'),
		repository: text(attributionValue.repository, 'repository'),
		license,
		copyright: text(attributionValue.copyright, 'copyright'),
		license_file: text(attributionValue.license_file, 'license_file'),
		snapshot_date: text(attributionValue.snapshot_date, 'snapshot_date')
	};
	if (!Array.isArray(root.providers) || root.providers.length === 0) {
		throw new Error('Provider catalog has no providers');
	}

	const providerIds = new Set<string>();
	const providers = root.providers.map((raw, providerIndex): CatalogProvider => {
		if (!raw || typeof raw !== 'object') throw new Error(`Invalid provider at index ${providerIndex}`);
		const item = raw as Record<string, unknown>;
		const id = text(item.id, 'provider id');
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || providerIds.has(id)) {
			throw new Error(`Invalid or duplicate provider id: ${id}`);
		}
		providerIds.add(id);
		const protocol = text(item.protocol, `${id} protocol`) as ProviderProtocol;
		if (!protocols.has(protocol)) throw new Error(`Invalid protocol for ${id}: ${protocol}`);
		const base_url = text(item.base_url, `${id} base_url`).replace(/\/+$/, '');
		try {
			const url = new URL(base_url);
			if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
		} catch {
			throw new Error(`Invalid base URL for ${id}`);
		}
		if (!Array.isArray(item.models) || item.models.length === 0) {
			throw new Error(`Provider ${id} has no models`);
		}
		const modelNames = new Set<string>();
		const models = item.models.map((rawModel, modelIndex): ProviderModel => {
			if (!rawModel || typeof rawModel !== 'object') {
				throw new Error(`Invalid model at ${id}[${modelIndex}]`);
			}
			const model = rawModel as Record<string, unknown>;
			const name = text(model.name, `${id} model name`);
			if (modelNames.has(name)) throw new Error(`Duplicate model ${id}/${name}`);
			modelNames.add(name);
			const efforts =
				model.reasoning_efforts == null
					? undefined
					: Array.isArray(model.reasoning_efforts)
						? model.reasoning_efforts.map((effort) => text(effort, `${id}/${name} effort`))
						: (() => {
								throw new Error(`Invalid reasoning efforts for ${id}/${name}`);
							})();
			return {
				name,
				context_window: positiveInt(model.context_window, `${id}/${name} context_window`),
				max_output_tokens: positiveInt(model.max_output_tokens, `${id}/${name} max_output_tokens`),
				reasoning_efforts: efforts
			};
		});
		return {
			id,
			name: text(item.name, `${id} name`),
			description: text(item.description, `${id} description`),
			base_url,
			protocol,
			models,
			docs_url: item.docs_url == null ? undefined : text(item.docs_url, `${id} docs_url`),
			featured: item.featured === true
		};
	});

	return { attribution, providers };
}

export function providerFormPrefill(provider: CatalogProvider): ProviderFormPrefill {
	return {
		id: provider.id,
		base_url: provider.base_url,
		format: provider.protocol,
		key: '',
		models: provider.models.map((model) => ({
			...model,
			reasoning_efforts: model.reasoning_efforts ? [...model.reasoning_efforts] : undefined
		}))
	};
}

export const PROVIDER_CATALOG = parseProviderCatalog(snapshot);
