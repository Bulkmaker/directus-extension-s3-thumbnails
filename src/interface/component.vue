<template>
	<div class="thumbnails-panel" v-if="isImage">
		<div class="panel-header">
			<span class="label">Thumbnails</span>
			<span class="count" v-if="thumbnails.length">{{ thumbnails.length }}</span>
		</div>

		<div v-if="loading" class="loading">
			<span>Loading...</span>
		</div>

		<div v-else-if="error" class="error">
			<span>{{ error }}</span>
		</div>

		<div v-else-if="thumbnails.length === 0" class="empty">
			<span>No thumbnails generated</span>
		</div>

		<div v-else class="thumbnails-list">
			<div
				v-for="thumb in thumbnails"
				:key="thumb.preset"
				class="thumbnail-item"
			>
				<div class="thumbnail-preview">
					<img
						:src="thumb.url"
						:alt="thumb.preset"
						@error="onImageError($event, thumb)"
						@load="onImageLoad(thumb)"
					/>
					<div v-if="thumb.loading" class="preview-loading"></div>
					<div v-if="thumb.error" class="preview-error">
						<span class="icon">!</span>
					</div>
				</div>
				<div class="thumbnail-info">
					<div class="preset-name">{{ thumb.preset }}</div>
					<div class="preset-size">{{ thumb.width }}×{{ thumb.height }}</div>
					<a :href="thumb.url" target="_blank" class="thumbnail-url">{{ thumb.url }}</a>
				</div>
				<button
					class="copy-button"
					@click="copyUrl(thumb.url)"
					:title="'Copy URL'"
				>
					<span v-if="copiedUrl === thumb.url" class="copied">✓</span>
					<span v-else class="copy-icon">📋</span>
				</button>
			</div>
		</div>
	</div>
	<div v-else class="not-image">
		<span class="muted">Not an image file</span>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';

interface Props {
	collection: string;
	primaryKey: string | number;
}

interface ThumbnailPreset {
	key: string;
	width?: number;
	height?: number;
	format?: string;
}

interface ThumbnailItem {
	preset: string;
	width: number;
	height: number;
	url: string;
	loading: boolean;
	error: boolean;
}

interface S3Config {
	baseUrl: string;
}

const props = defineProps<Props>();
const api = useApi();

const loading = ref(true);
const error = ref<string | null>(null);
const thumbnails = ref<ThumbnailItem[]>([]);
const copiedUrl = ref<string | null>(null);
const fileType = ref<string | null>(null);

const isImage = computed(() => {
	return fileType.value?.startsWith('image/') ?? false;
});

// Get format from preset (same logic as backend)
function getPresetFormat(preset: ThumbnailPreset): string {
	const format = preset.format?.toLowerCase();
	if (!format || format === 'auto' || format === '') {
		return 'webp';
	}
	if (format === 'jpeg') {
		return 'jpg';
	}
	return format;
}

// Get basename from filename
function getBasename(filename: string): string {
	const lastDot = filename.lastIndexOf('.');
	return lastDot > 0 ? filename.substring(0, lastDot) : filename;
}

// Build thumbnail URL
function buildThumbnailUrl(
	s3Config: S3Config,
	presetKey: string,
	basename: string,
	format: string
): string {
	return `${s3Config.baseUrl}/${presetKey}/${basename}.${format}`;
}

async function loadThumbnails() {
	if (!props.primaryKey || props.primaryKey === '+') {
		loading.value = false;
		return;
	}

	loading.value = true;
	error.value = null;
	thumbnails.value = [];

	try {
		// Load file data, settings, and S3 config in parallel
		const [fileResponse, settingsResponse, configResponse] = await Promise.all([
			api.get(`/files/${props.primaryKey}`, {
				params: { fields: ['filename_disk', 'type'] },
			}),
			api.get('/settings', {
				params: { fields: ['storage_asset_presets'] },
			}),
			api.get('/thumbnails/config'),
		]);

		const file = fileResponse.data.data;
		fileType.value = file.type;

		// Check if it's an image
		if (!file.type?.startsWith('image/')) {
			loading.value = false;
			return;
		}

		const presets: ThumbnailPreset[] = settingsResponse.data.data?.storage_asset_presets || [];
		const s3Config: S3Config = configResponse.data;

		if (!s3Config.baseUrl) {
			error.value = 'S3 not configured';
			loading.value = false;
			return;
		}

		const basename = getBasename(file.filename_disk);

		// Filter presets (skip huge dimensions like 9999)
		const MAX_DIMENSION = 5000;
		const validPresets = presets.filter((p) => {
			const w = p.width || 0;
			const h = p.height || 0;
			return w < MAX_DIMENSION && h < MAX_DIMENSION;
		});

		// Build thumbnail items
		thumbnails.value = validPresets.map((preset) => {
			const format = getPresetFormat(preset);
			const url = buildThumbnailUrl(s3Config, preset.key, basename, format);
			return {
				preset: preset.key,
				width: preset.width || 0,
				height: preset.height || 0,
				url,
				loading: true,
				error: false,
			};
		});
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load';
	} finally {
		loading.value = false;
	}
}

function onImageLoad(thumb: ThumbnailItem) {
	thumb.loading = false;
	thumb.error = false;
}

function onImageError(event: Event, thumb: ThumbnailItem) {
	thumb.loading = false;
	thumb.error = true;
}

async function copyUrl(url: string) {
	try {
		await navigator.clipboard.writeText(url);
		copiedUrl.value = url;
		setTimeout(() => {
			copiedUrl.value = null;
		}, 2000);
	} catch {
		// Fallback for older browsers
		const input = document.createElement('input');
		input.value = url;
		document.body.appendChild(input);
		input.select();
		document.execCommand('copy');
		document.body.removeChild(input);
		copiedUrl.value = url;
		setTimeout(() => {
			copiedUrl.value = null;
		}, 2000);
	}
}

// Watch for primaryKey changes
watch(
	() => props.primaryKey,
	() => {
		loadThumbnails();
	}
);

onMounted(() => {
	loadThumbnails();
});
</script>

<style scoped>
.thumbnails-panel {
	padding: 12px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
}

.panel-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
}

.panel-header .label {
	font-weight: 600;
	color: var(--theme--foreground);
}

.panel-header .count {
	background: var(--theme--primary);
	color: var(--theme--primary-background);
	padding: 2px 8px;
	border-radius: 12px;
	font-size: 12px;
	font-weight: 600;
}

.loading,
.error,
.empty,
.not-image {
	padding: 16px;
	text-align: center;
	color: var(--theme--foreground-subdued);
}

.error {
	color: var(--theme--danger);
}

.thumbnails-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.thumbnail-item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px;
	background: var(--theme--background);
	border-radius: var(--theme--border-radius);
	border: 1px solid var(--theme--border-color-subdued);
}

.thumbnail-preview {
	position: relative;
	width: 48px;
	height: 48px;
	flex-shrink: 0;
	border-radius: 4px;
	overflow: hidden;
	background: var(--theme--background-subdued);
}

.thumbnail-preview img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.preview-loading {
	position: absolute;
	inset: 0;
	background: var(--theme--background-subdued);
	animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
	0%, 100% { opacity: 0.5; }
	50% { opacity: 1; }
}

.preview-error {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--theme--danger-background);
	color: var(--theme--danger);
	font-size: 16px;
	font-weight: bold;
}

.thumbnail-info {
	flex: 1;
	min-width: 0;
}

.preset-name {
	font-weight: 500;
	color: var(--theme--foreground);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.preset-size {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.thumbnail-url {
	font-size: 10px;
	color: var(--theme--primary);
	word-break: break-all;
	display: block;
	margin-top: 4px;
}

.copy-button {
	flex-shrink: 0;
	width: 32px;
	height: 32px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: transparent;
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	transition: all 0.15s ease;
}

.copy-button:hover {
	background: var(--theme--background-subdued);
	border-color: var(--theme--primary);
}

.copy-button .copied {
	color: var(--theme--success);
}

.copy-button .copy-icon {
	font-size: 14px;
}

.muted {
	color: var(--theme--foreground-subdued);
}
</style>
