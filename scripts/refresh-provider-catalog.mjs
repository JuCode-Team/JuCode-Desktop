#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://models.dev/api.json';
const OUTPUT = fileURLToPath(new URL('../src/lib/providers/catalog.json', import.meta.url));

const selections = [
	{
		id: 'openrouter',
		name: 'OpenRouter',
		description: 'Use one key for models from OpenAI, Anthropic, Google, DeepSeek, Qwen, xAI and more.',
		base_url: 'https://openrouter.ai/api/v1',
		protocol: 'chat',
		featured: true,
		models: [
			'openai/gpt-5.6-sol',
			'anthropic/claude-opus-5',
			'google/gemini-3.7-flash',
			'deepseek/deepseek-v4-pro',
			'qwen/qwen3.8-max',
			'z-ai/glm-5.3',
			'x-ai/grok-4.6'
		]
	},
	{
		id: 'openai',
		name: 'OpenAI',
		description: 'Connect directly to OpenAI with the Responses API.',
		base_url: 'https://api.openai.com/v1',
		protocol: 'responses',
		models: ['gpt-5.6-sol', 'gpt-5.6', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.4']
	},
	{
		id: 'anthropic',
		name: 'Anthropic',
		description: 'Connect directly to the Anthropic Messages API.',
		base_url: 'https://api.anthropic.com/v1',
		protocol: 'anthropic',
		models: [
			'claude-opus-5',
			'claude-sonnet-5',
			'claude-fable-5',
			'claude-opus-4-8',
			'claude-sonnet-4-6'
		]
	},
	{
		id: 'deepseek',
		name: 'DeepSeek',
		description: 'Use DeepSeek models through its Anthropic-compatible endpoint.',
		base_url: 'https://api.deepseek.com/anthropic',
		protocol: 'anthropic',
		models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']
	},
	{
		id: 'groq',
		name: 'Groq',
		description: 'Run supported open-weight models on Groq infrastructure.',
		base_url: 'https://api.groq.com/openai/v1',
		protocol: 'chat',
		models: [
			'qwen/qwen3.6-27b',
			'openai/gpt-oss-120b',
			'openai/gpt-oss-20b',
			'llama-3.3-70b-versatile'
		]
	},
	{
		id: 'xai',
		name: 'xAI',
		description: 'Connect directly to the xAI API for Grok models.',
		base_url: 'https://api.x.ai/v1',
		protocol: 'chat',
		models: ['grok-4.6', 'grok-4.5', 'grok-4.3', 'grok-4.20-0309-reasoning']
	},
	{
		id: 'mistral',
		name: 'Mistral',
		description: 'Connect directly to Mistral for its general and coding models.',
		base_url: 'https://api.mistral.ai/v1',
		protocol: 'chat',
		models: [
			'zai-glm-5-2',
			'mistral-medium-latest',
			'mistral-small-latest',
			'magistral-medium-latest',
			'mistral-large-2411'
		]
	}
];

async function loadSource(source) {
	if (/^https?:\/\//.test(source)) {
		const response = await fetch(source);
		if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
		return response.json();
	}
	return JSON.parse(await readFile(source, 'utf8'));
}

function reasoningEfforts(model) {
	const option = model.reasoning_options?.find(
		(item) => item?.type === 'effort' && Array.isArray(item.values)
	);
	return option?.values?.length ? option.values : undefined;
}

function mapModel(providerId, modelId, model) {
	if (!model) throw new Error(`models.dev no longer contains ${providerId}/${modelId}`);
	if (!model.modalities?.output?.includes('text')) {
		throw new Error(`${providerId}/${modelId} does not produce text`);
	}
	if (model.status === 'deprecated') throw new Error(`${providerId}/${modelId} is deprecated`);
	return {
		name: model.id ?? modelId,
		context_window: model.limit?.context || undefined,
		max_output_tokens: model.limit?.output || undefined,
		reasoning_efforts: reasoningEfforts(model)
	};
}

const source = process.argv[2] ?? process.env.MODELS_DEV_SOURCE ?? SOURCE_URL;
const data = await loadSource(source);
const providers = selections.map((selection) => {
	const upstream = data[selection.id];
	if (!upstream?.models) throw new Error(`models.dev no longer contains provider ${selection.id}`);
	return {
		id: selection.id,
		name: upstream.name ?? selection.name,
		description: selection.description,
		base_url: selection.base_url,
		protocol: selection.protocol,
		docs_url: upstream.doc,
		featured: selection.featured === true,
		models: selection.models.map((id) => mapModel(selection.id, id, upstream.models[id]))
	};
});

const snapshot = {
	_attribution: {
		notice: 'Curated and transformed from models.dev. See models.dev.LICENSE.',
		source: SOURCE_URL,
		repository: 'https://github.com/anomalyco/models.dev',
		license: 'MIT',
		copyright: 'Copyright (c) 2025 models.dev',
		license_file: 'models.dev.LICENSE',
		snapshot_date: process.env.CATALOG_SNAPSHOT_DATE ?? new Date().toISOString().slice(0, 10)
	},
	providers
};

await writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Wrote ${providers.length} providers to ${OUTPUT}`);
