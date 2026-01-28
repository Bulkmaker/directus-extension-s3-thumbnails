<template>
	<private-view title="Thumbnails Manager">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="photo_size_select_large" />
			</v-button>
		</template>

		<template #actions>
			<v-button
				v-tooltip.bottom="'Refresh Stats'"
				rounded
				icon
				secondary
				:disabled="loading"
				@click="loadStats"
			>
				<v-icon name="refresh" />
			</v-button>
		</template>

		<div class="module-content">
			<!-- Stats Section -->
			<div class="stats-section">
				<div class="stat-card">
					<div class="stat-value">{{ stats.totalFiles }}</div>
					<div class="stat-label">Total Images</div>
				</div>
				<div class="stat-card">
					<div class="stat-value">{{ stats.presets }}</div>
					<div class="stat-label">Presets</div>
				</div>
				<div class="stat-card">
					<div class="stat-value">{{ stats.expectedThumbnails }}</div>
					<div class="stat-label">Expected Thumbnails</div>
				</div>
			</div>

			<!-- Presets List -->
			<div class="section">
				<h2 class="section-title">Asset Presets</h2>
				<div v-if="presetsList.length === 0" class="empty-state">
					No presets configured. Go to Settings → Files & Storage → Storage Asset Presets.
				</div>
				<div v-else class="presets-list">
					<div v-for="preset in presetsList" :key="preset.key" class="preset-item">
						<div class="preset-info">
							<span class="preset-key">{{ preset.key }}</span>
							<span class="preset-dims">{{ preset.width || '?' }}×{{ preset.height || '?' }}</span>
							<span class="preset-format">{{ preset.format || 'webp' }}</span>
						</div>
						<v-button
							small
							secondary
							:disabled="isRunning"
							@click="regeneratePreset(preset.key)"
						>
							Regenerate
						</v-button>
					</div>
				</div>
			</div>

			<!-- Actions Section -->
			<div class="section">
				<h2 class="section-title">Actions</h2>
				<div class="actions-grid">
					<div class="action-card">
						<h3>Regenerate All</h3>
						<p>Generate thumbnails for all image files using all presets.</p>
						<div class="action-options">
							<v-checkbox v-model="forceRegenerate" label="Force (overwrite existing)" />
						</div>
						<v-button :disabled="isRunning" @click="regenerateAll">
							<v-icon name="autorenew" />
							Start Regeneration
						</v-button>
					</div>

					<div class="action-card">
						<h3>Cleanup Preset</h3>
						<p>Delete all thumbnails for a specific preset from S3.</p>
						<v-select
							v-model="cleanupPreset"
							:items="presetOptions"
							placeholder="Select preset..."
						/>
						<v-button
							:disabled="isRunning || !cleanupPreset"
							secondary
							kind="danger"
							@click="confirmCleanup"
						>
							<v-icon name="delete" />
							Delete Thumbnails
						</v-button>
					</div>
				</div>
			</div>

			<!-- Progress Section -->
			<div v-if="isRunning || lastResult" class="section">
				<h2 class="section-title">Progress</h2>
				<div class="progress-card">
					<div v-if="isRunning" class="progress-running">
						<v-progress-linear :value="progress" />
						<div class="progress-text">
							{{ progressText }}
						</div>
						<v-button small secondary @click="cancelOperation">
							Cancel
						</v-button>
					</div>
					<div v-else-if="lastResult" class="progress-result">
						<div class="result-stats">
							<span class="result-item success">
								<v-icon name="check_circle" small />
								{{ lastResult.generated }} generated
							</span>
							<span class="result-item skipped">
								<v-icon name="skip_next" small />
								{{ lastResult.skipped }} skipped
							</span>
							<span v-if="lastResult.errors" class="result-item error">
								<v-icon name="error" small />
								{{ lastResult.errors }} errors
							</span>
						</div>
						<div class="result-time">
							Completed in {{ lastResult.duration }}s
						</div>
					</div>
				</div>
			</div>

			<!-- Log Section -->
			<div v-if="logs.length > 0" class="section">
				<h2 class="section-title">
					Log
					<v-button x-small secondary @click="logs = []">Clear</v-button>
				</h2>
				<div class="log-container">
					<div v-for="(log, i) in logs" :key="i" :class="['log-entry', log.type]">
						<span class="log-time">{{ log.time }}</span>
						<span class="log-message">{{ log.message }}</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Cleanup Confirmation Dialog -->
		<v-dialog v-model="showCleanupDialog" @esc="showCleanupDialog = false">
			<v-card>
				<v-card-title>Confirm Deletion</v-card-title>
				<v-card-text>
					Are you sure you want to delete all thumbnails for preset "{{ cleanupPreset }}"?
					This action cannot be undone.
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="showCleanupDialog = false">Cancel</v-button>
					<v-button kind="danger" @click="executeCleanup">Delete</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';

interface Preset {
	key: string;
	width?: number;
	height?: number;
	format?: string;
	fit?: string;
	quality?: number;
}

interface LogEntry {
	time: string;
	message: string;
	type: 'info' | 'success' | 'error';
}

interface LastResult {
	generated: number;
	skipped: number;
	errors: number;
	duration: number;
}

const api = useApi();

const loading = ref(false);
const isRunning = ref(false);
const progress = ref(0);
const progressText = ref('');
const forceRegenerate = ref(false);
const cleanupPreset = ref<string | null>(null);
const showCleanupDialog = ref(false);
const logs = ref<LogEntry[]>([]);
const lastResult = ref<LastResult | null>(null);
const presetsList = ref<Preset[]>([]);
let abortController: AbortController | null = null;

const stats = ref({
	totalFiles: 0,
	presets: 0,
	expectedThumbnails: 0,
});

const presetOptions = computed(() =>
	presetsList.value.map((p) => ({ text: p.key, value: p.key }))
);

function addLog(message: string, type: 'info' | 'success' | 'error' = 'info') {
	const now = new Date();
	const time = now.toLocaleTimeString();
	logs.value.unshift({ time, message, type });
	if (logs.value.length > 100) {
		logs.value.pop();
	}
}

async function loadStats() {
	loading.value = true;
	try {
		// Load presets
		const settingsResponse = await api.get('/settings', {
			params: { fields: ['storage_asset_presets'] },
		});
		const presets: Preset[] = settingsResponse.data.data?.storage_asset_presets || [];

		// Filter valid presets (skip huge dimensions)
		const MAX_DIMENSION = 5000;
		presetsList.value = presets.filter((p) => {
			const w = p.width || 0;
			const h = p.height || 0;
			return w < MAX_DIMENSION && h < MAX_DIMENSION;
		});

		// Count image files
		const filesResponse = await api.get('/files', {
			params: {
				filter: { type: { _starts_with: 'image/' } },
				aggregate: { count: '*' },
			},
		});
		const totalFiles = filesResponse.data.data?.[0]?.count || 0;

		stats.value = {
			totalFiles,
			presets: presetsList.value.length,
			expectedThumbnails: totalFiles * presetsList.value.length,
		};

		addLog(`Loaded stats: ${totalFiles} images, ${presetsList.value.length} presets`);
	} catch (err) {
		addLog(`Failed to load stats: ${err}`, 'error');
	} finally {
		loading.value = false;
	}
}

async function regenerateAll() {
	await runRegeneration({ force: forceRegenerate.value });
}

async function regeneratePreset(preset: string) {
	await runRegeneration({ preset, force: true });
}

async function runRegeneration(options: { preset?: string; force?: boolean }) {
	isRunning.value = true;
	progress.value = 0;
	progressText.value = 'Starting...';
	lastResult.value = null;
	abortController = new AbortController();

	const startTime = Date.now();
	let generated = 0;
	let skipped = 0;
	let errors = 0;

	addLog(`Starting regeneration${options.preset ? ` for preset "${options.preset}"` : ''}...`);

	try {
		const response = await fetch('/thumbnails/regenerate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${api.defaults.headers.common['Authorization']?.toString().replace('Bearer ', '')}`,
			},
			body: JSON.stringify({
				...options,
				sse: true,
			}),
			signal: abortController.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const reader = response.body?.getReader();
		if (!reader) throw new Error('No response body');

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					try {
						const data = JSON.parse(line.slice(6));

						if (data.type === 'progress') {
							progress.value = Math.round((data.current / data.total) * 100);
							progressText.value = `Processing ${data.current}/${data.total}: ${data.file || ''}`;
						} else if (data.type === 'file') {
							if (data.status === 'generated') generated++;
							else if (data.status === 'skipped') skipped++;
							else if (data.status === 'error') {
								errors++;
								addLog(`Error: ${data.file} - ${data.error}`, 'error');
							}
						} else if (data.type === 'complete') {
							generated = data.generated || generated;
							skipped = data.skipped || skipped;
							errors = data.errors || errors;
						}
					} catch {
						// Ignore parse errors
					}
				}
			}
		}

		const duration = Math.round((Date.now() - startTime) / 1000);
		lastResult.value = { generated, skipped, errors, duration };
		addLog(`Completed: ${generated} generated, ${skipped} skipped, ${errors} errors`, 'success');
	} catch (err) {
		if ((err as Error).name === 'AbortError') {
			addLog('Operation cancelled', 'info');
		} else {
			addLog(`Regeneration failed: ${err}`, 'error');
		}
	} finally {
		isRunning.value = false;
		abortController = null;
	}
}

function cancelOperation() {
	if (abortController) {
		abortController.abort();
	}
}

function confirmCleanup() {
	if (cleanupPreset.value) {
		showCleanupDialog.value = true;
	}
}

async function executeCleanup() {
	showCleanupDialog.value = false;
	if (!cleanupPreset.value) return;

	isRunning.value = true;
	addLog(`Deleting thumbnails for preset "${cleanupPreset.value}"...`);

	try {
		const response = await api.delete('/thumbnails/cleanup', {
			data: { preset: cleanupPreset.value },
		});

		const deleted = response.data?.deleted || 0;
		addLog(`Deleted ${deleted} thumbnails for preset "${cleanupPreset.value}"`, 'success');
	} catch (err) {
		addLog(`Cleanup failed: ${err}`, 'error');
	} finally {
		isRunning.value = false;
		cleanupPreset.value = null;
	}
}

onMounted(() => {
	loadStats();
});

onUnmounted(() => {
	if (abortController) {
		abortController.abort();
	}
});
</script>

<style scoped>
.module-content {
	padding: var(--content-padding);
	max-width: 1200px;
}

.stats-section {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 16px;
	margin-bottom: 32px;
}

.stat-card {
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	padding: 24px;
	text-align: center;
}

.stat-value {
	font-size: 36px;
	font-weight: 700;
	color: var(--theme--primary);
}

.stat-label {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	margin-top: 4px;
}

.section {
	margin-bottom: 32px;
}

.section-title {
	font-size: 18px;
	font-weight: 600;
	margin-bottom: 16px;
	display: flex;
	align-items: center;
	gap: 12px;
}

.presets-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.preset-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 16px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
}

.preset-info {
	display: flex;
	align-items: center;
	gap: 16px;
}

.preset-key {
	font-weight: 600;
	min-width: 120px;
}

.preset-dims {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
}

.preset-format {
	background: var(--theme--primary-background);
	color: var(--theme--primary);
	padding: 2px 8px;
	border-radius: 4px;
	font-size: 12px;
	text-transform: uppercase;
}

.actions-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
	gap: 16px;
}

.action-card {
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	padding: 24px;
}

.action-card h3 {
	font-size: 16px;
	font-weight: 600;
	margin-bottom: 8px;
}

.action-card p {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
	margin-bottom: 16px;
}

.action-options {
	margin-bottom: 16px;
}

.progress-card {
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	padding: 24px;
}

.progress-running {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.progress-text {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
}

.progress-result {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.result-stats {
	display: flex;
	gap: 24px;
	flex-wrap: wrap;
}

.result-item {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 14px;
}

.result-item.success {
	color: var(--theme--success);
}

.result-item.skipped {
	color: var(--theme--foreground-subdued);
}

.result-item.error {
	color: var(--theme--danger);
}

.result-time {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.log-container {
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	padding: 16px;
	max-height: 300px;
	overflow-y: auto;
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 12px;
}

.log-entry {
	display: flex;
	gap: 12px;
	padding: 4px 0;
	border-bottom: 1px solid var(--theme--border-color-subdued);
}

.log-entry:last-child {
	border-bottom: none;
}

.log-entry.success .log-message {
	color: var(--theme--success);
}

.log-entry.error .log-message {
	color: var(--theme--danger);
}

.log-time {
	color: var(--theme--foreground-subdued);
	flex-shrink: 0;
}

.empty-state {
	padding: 24px;
	text-align: center;
	color: var(--theme--foreground-subdued);
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
}

.header-icon {
	--v-button-background-color: var(--theme--primary-background);
	--v-button-color: var(--theme--primary);
}
</style>
