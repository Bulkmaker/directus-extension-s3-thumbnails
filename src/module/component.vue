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
					<div class="stat-value">{{ stats.actualThumbnails }}</div>
					<div class="stat-label">Generated Thumbnails</div>
				</div>
				<div class="stat-card" :class="{ 'stat-warning': stats.missingThumbnails > 0 }">
					<div class="stat-value">{{ stats.missingThumbnails }}</div>
					<div class="stat-label">Missing Thumbnails</div>
				</div>
				<div class="stat-card" :class="{ 'stat-outdated': stats.outdatedThumbnails > 0 }">
					<div class="stat-value">{{ stats.outdatedThumbnails }}</div>
					<div class="stat-label">Outdated Thumbnails</div>
				</div>
			</div>

			<!-- Presets List -->
			<div class="section">
				<h2 class="section-title">Asset Presets</h2>
				<div v-if="presetsList.length === 0" class="empty-state">
					No presets configured. Go to Settings → Files & Storage → Storage Asset Presets.
				</div>
				<div v-else class="presets-list">
					<div v-for="preset in presetsList" :key="preset.key" class="preset-item" :class="{ 'preset-outdated': preset.outdated }">
						<div class="preset-info">
							<span class="preset-key">{{ preset.key }}</span>
							<span class="preset-dims">{{ preset.width || '?' }}×{{ preset.height || '?' }}</span>
							<span class="preset-format">{{ preset.format || 'webp' }}</span>
							<span class="preset-count" :class="{ 'preset-missing': (preset.missing || 0) > 0 }">
								{{ preset.count || 0 }}/{{ preset.expected || 0 }}
								<span v-if="(preset.missing || 0) > 0" class="missing-badge">-{{ preset.missing }}</span>
							</span>
							<span v-if="preset.outdated" class="outdated-badge">
								<v-icon name="warning" x-small />
								outdated
							</span>
						</div>
						<v-button
							small
							:secondary="!preset.outdated"
							:kind="preset.outdated ? 'warning' : undefined"
							:disabled="isRunning"
							@click="regeneratePreset(preset.key)"
						>
							{{ preset.outdated ? 'Regenerate!' : 'Regenerate' }}
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

			<!-- Orphan Folders Section -->
			<div class="section">
				<h2 class="section-title">
					Orphan Folders
					<v-button x-small secondary :disabled="scanningOrphans" @click="scanOrphans">
						<v-icon name="search" x-small />
						Scan S3
					</v-button>
				</h2>
				<div v-if="scanningOrphans" class="empty-state">
					Scanning S3 folders...
				</div>
				<div v-else-if="orphanFolders.length === 0" class="empty-state">
					No orphan folders found. Click "Scan S3" to check.
				</div>
				<div v-else class="orphans-list">
					<div v-for="orphan in orphanFolders" :key="orphan.folder" class="orphan-item">
						<div class="orphan-info">
							<span class="orphan-name">{{ orphan.folder }}</span>
							<span class="orphan-count">{{ orphan.count }} files</span>
						</div>
						<v-button
							small
							secondary
							kind="danger"
							:disabled="isRunning"
							@click="deleteOrphan(orphan.folder)"
						>
							Delete
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
	count?: number;
	expected?: number;
	missing?: number;
	outdated?: boolean;
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
let sseAbortController: AbortController | null = null;
let jobStartTime: number | null = null;

const stats = ref({
	totalFiles: 0,
	presets: 0,
	expectedThumbnails: 0,
	actualThumbnails: 0,
	missingThumbnails: 0,
	outdatedThumbnails: 0,
});

const presetOptions = computed(() =>
	presetsList.value.map((p) => ({ text: p.key, value: p.key }))
);

// Orphan folders state
interface OrphanFolder {
	folder: string;
	count: number;
}
const scanningOrphans = ref(false);
const orphanFolders = ref<OrphanFolder[]>([]);

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
		// Load stats from dedicated endpoint (includes S3 thumbnail counts)
		const statsResponse = await api.get('/thumbnails/stats');
		const data = statsResponse.data;

		presetsList.value = data.presets || [];

		stats.value = {
			totalFiles: data.totalImages || 0,
			presets: data.totalPresets || 0,
			expectedThumbnails: data.totalExpected || 0,
			actualThumbnails: data.totalThumbnails || 0,
			missingThumbnails: data.totalMissing || 0,
			outdatedThumbnails: data.totalOutdated || 0,
		};

		const outdatedMsg = stats.value.outdatedThumbnails > 0 ? `, ${stats.value.outdatedThumbnails} outdated` : '';
		addLog(`Loaded stats: ${stats.value.totalFiles} images, ${stats.value.actualThumbnails}/${stats.value.expectedThumbnails} thumbnails${outdatedMsg}`);
	} catch (err) {
		addLog(`Failed to load stats: ${err}`, 'error');
	} finally {
		loading.value = false;
	}
}

// Check if there's an existing job and connect to it
async function checkExistingJob() {
	try {
		const response = await api.get('/thumbnails/regenerate/status');
		const data = response.data;

		if (data.status === 'running') {
			addLog('Found running job, reconnecting...', 'info');
			jobStartTime = new Date(data.startedAt).getTime();
			connectToSSE();
		} else if (data.status === 'completed' || data.status === 'cancelled' || data.status === 'error') {
			// Show last result
			const duration = data.completedAt
				? Math.round((new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime()) / 1000)
				: 0;
			lastResult.value = {
				generated: data.progress?.generated || 0,
				skipped: data.progress?.skipped || 0,
				errors: data.progress?.errors || 0,
				duration,
			};
			if (data.status === 'error') {
				addLog(`Previous job ended with error: ${data.error}`, 'error');
			}
		}
	} catch {
		// No existing job or endpoint not available
	}
}

// Connect to SSE stream for progress updates
function connectToSSE() {
	if (sseAbortController) {
		sseAbortController.abort();
	}

	sseAbortController = new AbortController();
	isRunning.value = true;
	progress.value = 0;
	progressText.value = 'Connecting...';

	fetch('/thumbnails/regenerate/status?sse=true', {
		credentials: 'include',
		signal: sseAbortController.signal,
	})
		.then(async (response) => {
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
							handleSSEData(data);
						} catch {
							// Ignore parse errors
						}
					}
				}
			}
		})
		.catch((err) => {
			if ((err as Error).name !== 'AbortError') {
				addLog(`SSE connection failed: ${err}`, 'error');
			}
		})
		.finally(() => {
			isRunning.value = false;
			sseAbortController = null;
		});
}

function handleSSEData(data: any) {
	if (data.status === 'idle') {
		isRunning.value = false;
		return;
	}

	if (data.status === 'completed' || data.status === 'cancelled' || data.status === 'error') {
		isRunning.value = false;

		const duration = jobStartTime
			? Math.round((Date.now() - jobStartTime) / 1000)
			: 0;

		lastResult.value = {
			generated: data.generated || 0,
			skipped: data.skipped || 0,
			errors: data.errors || 0,
			duration,
		};

		if (data.status === 'completed') {
			addLog(`Completed: ${data.generated} generated, ${data.skipped} skipped, ${data.errors} errors`, 'success');
		} else if (data.status === 'cancelled') {
			addLog('Job cancelled', 'info');
		} else if (data.status === 'error') {
			addLog(`Job failed: ${data.error}`, 'error');
		}

		// Log individual errors
		if (data.failed?.length) {
			for (const f of data.failed.slice(0, 10)) {
				addLog(`Error: ${f.id} - ${f.error}`, 'error');
			}
			if (data.failed.length > 10) {
				addLog(`... and ${data.failed.length - 10} more errors`, 'error');
			}
		}

		return;
	}

	// Running state — update progress
	progress.value = data.percent || 0;
	progressText.value = `Processing ${data.processed || 0}/${data.total || 0}`;
}

async function regenerateAll() {
	await startRegeneration({ force: forceRegenerate.value });
}

async function regeneratePreset(preset: string) {
	await startRegeneration({ preset, force: true });
}

async function startRegeneration(options: { preset?: string; force?: boolean }) {
	lastResult.value = null;
	jobStartTime = Date.now();

	addLog(`Starting regeneration${options.preset ? ` for preset "${options.preset}"` : ''}...`);

	try {
		const response = await api.post('/thumbnails/regenerate', options);

		if (response.status === 409) {
			// Job already running — connect to it
			addLog('Job already running, connecting...', 'info');
			connectToSSE();
			return;
		}

		const { jobId, status, total } = response.data;

		if (status === 'completed') {
			addLog(response.data.message || 'No files to process', 'info');
			return;
		}

		addLog(`Job ${jobId} started: ${total} files`, 'info');
		connectToSSE();
	} catch (err: any) {
		if (err.response?.status === 409) {
			// Job already running — connect to it
			addLog('Job already running, connecting...', 'info');
			connectToSSE();
			return;
		}
		addLog(`Failed to start regeneration: ${err}`, 'error');
	}
}

async function cancelOperation() {
	try {
		// Try to cancel both regenerate and cleanup
		await api.delete('/thumbnails/regenerate').catch(() => {});
		await api.post('/thumbnails/cleanup/cancel').catch(() => {});
		addLog('Cancellation requested...', 'info');
	} catch (err) {
		addLog(`Failed to cancel: ${err}`, 'error');
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

	const presetToCleanup = cleanupPreset.value;
	cleanupPreset.value = null;

	isRunning.value = true;
	progress.value = 0;
	progressText.value = 'Counting files...';
	lastResult.value = null;
	jobStartTime = Date.now();

	addLog(`Deleting thumbnails for preset "${presetToCleanup}"...`);

	if (sseAbortController) {
		sseAbortController.abort();
	}
	sseAbortController = new AbortController();

	try {
		const response = await fetch('/thumbnails/cleanup', {
			method: 'DELETE',
			headers: {
				'Content-Type': 'application/json',
			},
			credentials: 'include',
			body: JSON.stringify({
				preset: presetToCleanup,
				sse: true,
			}),
			signal: sseAbortController.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const reader = response.body?.getReader();
		if (!reader) throw new Error('No response body');

		const decoder = new TextDecoder();
		let buffer = '';
		let finalDeleted = 0;

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

						progress.value = data.percent || 0;
						progressText.value = `Deleting ${data.deleted || 0}/${data.total || 0}`;
						finalDeleted = data.deleted || 0;

						if (data.status === 'completed') {
							const duration = jobStartTime
								? Math.round((Date.now() - jobStartTime) / 1000)
								: 0;
							lastResult.value = {
								generated: 0,
								skipped: 0,
								errors: 0,
								duration,
							};
							addLog(`Deleted ${finalDeleted} thumbnails for preset "${presetToCleanup}"`, 'success');
						} else if (data.status === 'cancelled') {
							addLog('Cleanup cancelled', 'info');
						} else if (data.status === 'error') {
							addLog(`Cleanup failed: ${data.error}`, 'error');
						}
					} catch {
						// Ignore parse errors
					}
				}
			}
		}
	} catch (err) {
		if ((err as Error).name !== 'AbortError') {
			addLog(`Cleanup failed: ${err}`, 'error');
		}
	} finally {
		isRunning.value = false;
		sseAbortController = null;
	}
}

async function scanOrphans() {
	scanningOrphans.value = true;
	orphanFolders.value = [];

	try {
		const response = await api.get('/thumbnails/cleanup/orphans');
		orphanFolders.value = response.data.orphans || [];

		if (orphanFolders.value.length === 0) {
			addLog('No orphan folders found', 'info');
		} else {
			addLog(`Found ${orphanFolders.value.length} orphan folder(s)`, 'info');
		}
	} catch (err) {
		addLog(`Failed to scan orphans: ${err}`, 'error');
	} finally {
		scanningOrphans.value = false;
	}
}

async function deleteOrphan(folder: string) {
	isRunning.value = true;
	addLog(`Deleting orphan folder "${folder}"...`);

	try {
		const response = await api.delete(`/thumbnails/cleanup/orphan/${encodeURIComponent(folder)}`);
		const deleted = response.data.deleted || 0;
		addLog(`Deleted ${deleted} files from orphan folder "${folder}"`, 'success');

		// Remove from list
		orphanFolders.value = orphanFolders.value.filter((o) => o.folder !== folder);
	} catch (err) {
		addLog(`Failed to delete orphan: ${err}`, 'error');
	} finally {
		isRunning.value = false;
	}
}

onMounted(() => {
	loadStats();
	checkExistingJob();
});

onUnmounted(() => {
	if (sseAbortController) {
		sseAbortController.abort();
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

.preset-count {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
	font-family: var(--theme--fonts--monospace--font-family);
}

.preset-count.preset-missing {
	color: var(--theme--warning);
}

.missing-badge {
	background: var(--theme--warning-background);
	color: var(--theme--warning);
	padding: 1px 6px;
	border-radius: 4px;
	font-size: 11px;
	margin-left: 4px;
}

.outdated-badge {
	background: var(--theme--danger-background);
	color: var(--theme--danger);
	padding: 2px 8px;
	border-radius: 4px;
	font-size: 11px;
	margin-left: 8px;
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.preset-item.preset-outdated {
	border: 1px solid var(--theme--danger);
	background: var(--theme--danger-background);
}

.stat-card.stat-warning .stat-value {
	color: var(--theme--warning);
}

.stat-card.stat-outdated .stat-value {
	color: var(--theme--danger);
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

.orphans-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.orphan-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 16px;
	background: var(--theme--danger-background);
	border-radius: var(--theme--border-radius);
	border: 1px solid var(--theme--danger);
}

.orphan-info {
	display: flex;
	align-items: center;
	gap: 16px;
}

.orphan-name {
	font-weight: 600;
	color: var(--theme--danger);
}

.orphan-count {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
}
</style>
