import { useApi, defineInterface, defineModule } from '@directus/extensions-sdk';
import { defineComponent, ref, computed, watch, onMounted, openBlock, createElementBlock, createElementVNode, toDisplayString, createCommentVNode, Fragment, renderList, onUnmounted, resolveComponent, resolveDirective, createBlock, withCtx, createVNode, withDirectives, normalizeClass, createTextVNode } from 'vue';

const _hoisted_1$1 = {
  key: 0,
  class: "thumbnails-panel"
};
const _hoisted_2$1 = { class: "panel-header" };
const _hoisted_3$1 = {
  key: 0,
  class: "count"
};
const _hoisted_4$1 = {
  key: 0,
  class: "loading"
};
const _hoisted_5$1 = {
  key: 1,
  class: "error"
};
const _hoisted_6$1 = {
  key: 2,
  class: "empty"
};
const _hoisted_7$1 = {
  key: 3,
  class: "thumbnails-list"
};
const _hoisted_8$1 = { class: "thumbnail-preview" };
const _hoisted_9$1 = ["src", "alt", "onError", "onLoad"];
const _hoisted_10$1 = {
  key: 0,
  class: "preview-loading"
};
const _hoisted_11$1 = {
  key: 1,
  class: "preview-error"
};
const _hoisted_12$1 = { class: "thumbnail-info" };
const _hoisted_13$1 = { class: "preset-name" };
const _hoisted_14$1 = { class: "preset-size" };
const _hoisted_15$1 = ["href"];
const _hoisted_16$1 = ["onClick"];
const _hoisted_17$1 = {
  key: 0,
  class: "copied"
};
const _hoisted_18$1 = {
  key: 1,
  class: "copy-icon"
};
const _hoisted_19$1 = {
  key: 1,
  class: "not-image"
};
var _sfc_main$1 = /* @__PURE__ */ defineComponent({
  __name: "component",
  props: {
    collection: {},
    primaryKey: {}
  },
  setup(__props) {
    const props = __props;
    const api = useApi();
    const loading = ref(true);
    const error = ref(null);
    const thumbnails = ref([]);
    const copiedUrl = ref(null);
    const fileType = ref(null);
    const isImage = computed(() => {
      return fileType.value?.startsWith("image/") ?? false;
    });
    function getPresetFormat(preset) {
      const format = preset.format?.toLowerCase();
      if (!format || format === "auto" || format === "") {
        return "webp";
      }
      if (format === "jpeg") {
        return "jpg";
      }
      return format;
    }
    function getBasename(filename) {
      const lastDot = filename.lastIndexOf(".");
      return lastDot > 0 ? filename.substring(0, lastDot) : filename;
    }
    function buildThumbnailUrl(s3Config, presetKey, basename, format) {
      return `${s3Config.baseUrl}/${presetKey}/${basename}.${format}`;
    }
    async function loadThumbnails() {
      if (!props.primaryKey || props.primaryKey === "+") {
        loading.value = false;
        return;
      }
      loading.value = true;
      error.value = null;
      thumbnails.value = [];
      try {
        const [fileResponse, settingsResponse, configResponse] = await Promise.all([
          api.get(`/files/${props.primaryKey}`, {
            params: { fields: ["filename_disk", "type"] }
          }),
          api.get("/settings", {
            params: { fields: ["storage_asset_presets"] }
          }),
          api.get("/thumbnails/config")
        ]);
        const file = fileResponse.data.data;
        fileType.value = file.type;
        if (!file.type?.startsWith("image/")) {
          loading.value = false;
          return;
        }
        const presets = settingsResponse.data.data?.storage_asset_presets || [];
        const s3Config = configResponse.data;
        if (!s3Config.baseUrl) {
          error.value = "S3 not configured";
          loading.value = false;
          return;
        }
        const basename = getBasename(file.filename_disk);
        const MAX_DIMENSION = 5e3;
        const validPresets = presets.filter((p) => {
          const w = p.width || 0;
          const h = p.height || 0;
          return w < MAX_DIMENSION && h < MAX_DIMENSION;
        });
        thumbnails.value = validPresets.map((preset) => {
          const format = getPresetFormat(preset);
          const url = buildThumbnailUrl(s3Config, preset.key, basename, format);
          return {
            preset: preset.key,
            width: preset.width || 0,
            height: preset.height || 0,
            url,
            loading: true,
            error: false
          };
        });
      } catch (err) {
        error.value = err instanceof Error ? err.message : "Failed to load";
      } finally {
        loading.value = false;
      }
    }
    function onImageLoad(thumb) {
      thumb.loading = false;
      thumb.error = false;
    }
    function onImageError(event, thumb) {
      thumb.loading = false;
      thumb.error = true;
    }
    async function copyUrl(url) {
      try {
        await navigator.clipboard.writeText(url);
        copiedUrl.value = url;
        setTimeout(() => {
          copiedUrl.value = null;
        }, 2e3);
      } catch {
        const input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        copiedUrl.value = url;
        setTimeout(() => {
          copiedUrl.value = null;
        }, 2e3);
      }
    }
    watch(
      () => props.primaryKey,
      () => {
        loadThumbnails();
      }
    );
    onMounted(() => {
      loadThumbnails();
    });
    return (_ctx, _cache) => {
      return isImage.value ? (openBlock(), createElementBlock("div", _hoisted_1$1, [
        createElementVNode("div", _hoisted_2$1, [
          _cache[0] || (_cache[0] = createElementVNode(
            "span",
            { class: "label" },
            "Thumbnails",
            -1
            /* HOISTED */
          )),
          thumbnails.value.length ? (openBlock(), createElementBlock(
            "span",
            _hoisted_3$1,
            toDisplayString(thumbnails.value.length),
            1
            /* TEXT */
          )) : createCommentVNode("v-if", true)
        ]),
        loading.value ? (openBlock(), createElementBlock("div", _hoisted_4$1, _cache[1] || (_cache[1] = [
          createElementVNode(
            "span",
            null,
            "Loading...",
            -1
            /* HOISTED */
          )
        ]))) : error.value ? (openBlock(), createElementBlock("div", _hoisted_5$1, [
          createElementVNode(
            "span",
            null,
            toDisplayString(error.value),
            1
            /* TEXT */
          )
        ])) : thumbnails.value.length === 0 ? (openBlock(), createElementBlock("div", _hoisted_6$1, _cache[2] || (_cache[2] = [
          createElementVNode(
            "span",
            null,
            "No thumbnails generated",
            -1
            /* HOISTED */
          )
        ]))) : (openBlock(), createElementBlock("div", _hoisted_7$1, [
          (openBlock(true), createElementBlock(
            Fragment,
            null,
            renderList(thumbnails.value, (thumb) => {
              return openBlock(), createElementBlock("div", {
                key: thumb.preset,
                class: "thumbnail-item"
              }, [
                createElementVNode("div", _hoisted_8$1, [
                  createElementVNode("img", {
                    src: thumb.url,
                    alt: thumb.preset,
                    onError: ($event) => onImageError($event, thumb),
                    onLoad: ($event) => onImageLoad(thumb)
                  }, null, 40, _hoisted_9$1),
                  thumb.loading ? (openBlock(), createElementBlock("div", _hoisted_10$1)) : createCommentVNode("v-if", true),
                  thumb.error ? (openBlock(), createElementBlock("div", _hoisted_11$1, _cache[3] || (_cache[3] = [
                    createElementVNode(
                      "span",
                      { class: "icon" },
                      "!",
                      -1
                      /* HOISTED */
                    )
                  ]))) : createCommentVNode("v-if", true)
                ]),
                createElementVNode("div", _hoisted_12$1, [
                  createElementVNode(
                    "div",
                    _hoisted_13$1,
                    toDisplayString(thumb.preset),
                    1
                    /* TEXT */
                  ),
                  createElementVNode(
                    "div",
                    _hoisted_14$1,
                    toDisplayString(thumb.width) + "\xD7" + toDisplayString(thumb.height),
                    1
                    /* TEXT */
                  ),
                  createElementVNode("a", {
                    href: thumb.url,
                    target: "_blank",
                    class: "thumbnail-url"
                  }, toDisplayString(thumb.url), 9, _hoisted_15$1)
                ]),
                createElementVNode("button", {
                  class: "copy-button",
                  onClick: ($event) => copyUrl(thumb.url),
                  title: "Copy URL"
                }, [
                  copiedUrl.value === thumb.url ? (openBlock(), createElementBlock("span", _hoisted_17$1, "\u2713")) : (openBlock(), createElementBlock("span", _hoisted_18$1, "\u{1F4CB}"))
                ], 8, _hoisted_16$1)
              ]);
            }),
            128
            /* KEYED_FRAGMENT */
          ))
        ]))
      ])) : (openBlock(), createElementBlock("div", _hoisted_19$1, _cache[4] || (_cache[4] = [
        createElementVNode(
          "span",
          { class: "muted" },
          "Not an image file",
          -1
          /* HOISTED */
        )
      ])));
    };
  }
});

var e=[],t=[];function n(n,r){if(n&&"undefined"!=typeof document){var a,s=!0===r.prepend?"prepend":"append",d=!0===r.singleTag,i="string"==typeof r.container?document.querySelector(r.container):document.getElementsByTagName("head")[0];if(d){var u=e.indexOf(i);-1===u&&(u=e.push(i)-1,t[u]={}),a=t[u]&&t[u][s]?t[u][s]:t[u][s]=c();}else a=c();65279===n.charCodeAt(0)&&(n=n.substring(1)),a.styleSheet?a.styleSheet.cssText+=n:a.appendChild(document.createTextNode(n));}function c(){var e=document.createElement("style");if(e.setAttribute("type","text/css"),r.attributes)for(var t=Object.keys(r.attributes),n=0;n<t.length;n++)e.setAttribute(t[n],r.attributes[t[n]]);var a="prepend"===s?"afterbegin":"beforeend";return i.insertAdjacentElement(a,e),e}}

var css$1 = "\n.thumbnails-panel[data-v-4e271073] {\n\tpadding: 12px;\n\tbackground: var(--theme--background-subdued);\n\tborder-radius: var(--theme--border-radius);\n}\n.panel-header[data-v-4e271073] {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 8px;\n\tmargin-bottom: 12px;\n}\n.panel-header .label[data-v-4e271073] {\n\tfont-weight: 600;\n\tcolor: var(--theme--foreground);\n}\n.panel-header .count[data-v-4e271073] {\n\tbackground: var(--theme--primary);\n\tcolor: var(--theme--primary-background);\n\tpadding: 2px 8px;\n\tborder-radius: 12px;\n\tfont-size: 12px;\n\tfont-weight: 600;\n}\n.loading[data-v-4e271073],\n.error[data-v-4e271073],\n.empty[data-v-4e271073],\n.not-image[data-v-4e271073] {\n\tpadding: 16px;\n\ttext-align: center;\n\tcolor: var(--theme--foreground-subdued);\n}\n.error[data-v-4e271073] {\n\tcolor: var(--theme--danger);\n}\n.thumbnails-list[data-v-4e271073] {\n\tdisplay: flex;\n\tflex-direction: column;\n\tgap: 8px;\n}\n.thumbnail-item[data-v-4e271073] {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 12px;\n\tpadding: 8px;\n\tbackground: var(--theme--background);\n\tborder-radius: var(--theme--border-radius);\n\tborder: 1px solid var(--theme--border-color-subdued);\n}\n.thumbnail-preview[data-v-4e271073] {\n\tposition: relative;\n\twidth: 48px;\n\theight: 48px;\n\tflex-shrink: 0;\n\tborder-radius: 4px;\n\toverflow: hidden;\n\tbackground: var(--theme--background-subdued);\n}\n.thumbnail-preview img[data-v-4e271073] {\n\twidth: 100%;\n\theight: 100%;\n\tobject-fit: cover;\n}\n.preview-loading[data-v-4e271073] {\n\tposition: absolute;\n\tinset: 0;\n\tbackground: var(--theme--background-subdued);\n\tanimation: pulse-4e271073 1.5s ease-in-out infinite;\n}\n@keyframes pulse-4e271073 {\n0%, 100% { opacity: 0.5;\n}\n50% { opacity: 1;\n}\n}\n.preview-error[data-v-4e271073] {\n\tposition: absolute;\n\tinset: 0;\n\tdisplay: flex;\n\talign-items: center;\n\tjustify-content: center;\n\tbackground: var(--theme--danger-background);\n\tcolor: var(--theme--danger);\n\tfont-size: 16px;\n\tfont-weight: bold;\n}\n.thumbnail-info[data-v-4e271073] {\n\tflex: 1;\n\tmin-width: 0;\n}\n.preset-name[data-v-4e271073] {\n\tfont-weight: 500;\n\tcolor: var(--theme--foreground);\n\twhite-space: nowrap;\n\toverflow: hidden;\n\ttext-overflow: ellipsis;\n}\n.preset-size[data-v-4e271073] {\n\tfont-size: 12px;\n\tcolor: var(--theme--foreground-subdued);\n}\n.thumbnail-url[data-v-4e271073] {\n\tfont-size: 10px;\n\tcolor: var(--theme--primary);\n\tword-break: break-all;\n\tdisplay: block;\n\tmargin-top: 4px;\n}\n.copy-button[data-v-4e271073] {\n\tflex-shrink: 0;\n\twidth: 32px;\n\theight: 32px;\n\tdisplay: flex;\n\talign-items: center;\n\tjustify-content: center;\n\tbackground: transparent;\n\tborder: 1px solid var(--theme--border-color-subdued);\n\tborder-radius: var(--theme--border-radius);\n\tcursor: pointer;\n\ttransition: all 0.15s ease;\n}\n.copy-button[data-v-4e271073]:hover {\n\tbackground: var(--theme--background-subdued);\n\tborder-color: var(--theme--primary);\n}\n.copy-button .copied[data-v-4e271073] {\n\tcolor: var(--theme--success);\n}\n.copy-button .copy-icon[data-v-4e271073] {\n\tfont-size: 14px;\n}\n.muted[data-v-4e271073] {\n\tcolor: var(--theme--foreground-subdued);\n}\n";
n(css$1,{});

var _export_sfc = (sfc, props) => {
  const target = sfc.__vccOpts || sfc;
  for (const [key, val] of props) {
    target[key] = val;
  }
  return target;
};

var InterfaceComponent = /* @__PURE__ */ _export_sfc(_sfc_main$1, [["__scopeId", "data-v-4e271073"], ["__file", "component.vue"]]);

var e0 = defineInterface({
  id: "thumbnails-panel",
  name: "Thumbnails Panel",
  description: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u043C\u0438\u043D\u0438\u0430\u0442\u044E\u0440\u044B \u0434\u043B\u044F \u0444\u0430\u0439\u043B\u0430 \u0441 \u0441\u0441\u044B\u043B\u043A\u0430\u043C\u0438 \u043D\u0430 S3",
  icon: "photo_size_select_large",
  component: InterfaceComponent,
  types: ["alias"],
  localTypes: ["presentation"],
  group: "presentation",
  options: null
});

const _hoisted_1 = { class: "module-content" };
const _hoisted_2 = { class: "stats-section" };
const _hoisted_3 = { class: "stat-card" };
const _hoisted_4 = { class: "stat-value" };
const _hoisted_5 = { class: "stat-card" };
const _hoisted_6 = { class: "stat-value" };
const _hoisted_7 = { class: "stat-card" };
const _hoisted_8 = { class: "stat-value" };
const _hoisted_9 = { class: "stat-value" };
const _hoisted_10 = { class: "stat-value" };
const _hoisted_11 = { class: "section" };
const _hoisted_12 = {
  key: 0,
  class: "empty-state"
};
const _hoisted_13 = {
  key: 1,
  class: "presets-list"
};
const _hoisted_14 = { class: "preset-info" };
const _hoisted_15 = { class: "preset-key" };
const _hoisted_16 = { class: "preset-dims" };
const _hoisted_17 = { class: "preset-format" };
const _hoisted_18 = {
  key: 0,
  class: "missing-badge"
};
const _hoisted_19 = {
  key: 0,
  class: "outdated-badge"
};
const _hoisted_20 = { class: "section" };
const _hoisted_21 = { class: "actions-grid" };
const _hoisted_22 = { class: "action-card" };
const _hoisted_23 = { class: "action-options" };
const _hoisted_24 = { class: "action-card" };
const _hoisted_25 = { class: "section" };
const _hoisted_26 = { class: "section-title" };
const _hoisted_27 = {
  key: 0,
  class: "empty-state"
};
const _hoisted_28 = {
  key: 1,
  class: "empty-state"
};
const _hoisted_29 = {
  key: 2,
  class: "orphans-list"
};
const _hoisted_30 = { class: "orphan-info" };
const _hoisted_31 = { class: "orphan-name" };
const _hoisted_32 = { class: "orphan-count" };
const _hoisted_33 = {
  key: 0,
  class: "section"
};
const _hoisted_34 = { class: "progress-card" };
const _hoisted_35 = {
  key: 0,
  class: "progress-running"
};
const _hoisted_36 = { class: "progress-text" };
const _hoisted_37 = {
  key: 1,
  class: "progress-result"
};
const _hoisted_38 = { class: "result-stats" };
const _hoisted_39 = { class: "result-item success" };
const _hoisted_40 = { class: "result-item skipped" };
const _hoisted_41 = {
  key: 0,
  class: "result-item error"
};
const _hoisted_42 = { class: "result-time" };
const _hoisted_43 = {
  key: 1,
  class: "section"
};
const _hoisted_44 = { class: "section-title" };
const _hoisted_45 = { class: "log-container" };
const _hoisted_46 = { class: "log-time" };
const _hoisted_47 = { class: "log-message" };
var _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "component",
  setup(__props) {
    const api = useApi();
    const loading = ref(false);
    const isRunning = ref(false);
    const progress = ref(0);
    const progressText = ref("");
    const forceRegenerate = ref(false);
    const cleanupPreset = ref(null);
    const showCleanupDialog = ref(false);
    const logs = ref([]);
    const lastResult = ref(null);
    const presetsList = ref([]);
    let sseAbortController = null;
    let jobStartTime = null;
    const stats = ref({
      totalFiles: 0,
      presets: 0,
      expectedThumbnails: 0,
      actualThumbnails: 0,
      missingThumbnails: 0,
      outdatedThumbnails: 0
    });
    const presetOptions = computed(
      () => presetsList.value.map((p) => ({ text: p.key, value: p.key }))
    );
    const scanningOrphans = ref(false);
    const orphanFolders = ref([]);
    function addLog(message, type = "info") {
      const now = /* @__PURE__ */ new Date();
      const time = now.toLocaleTimeString();
      logs.value.unshift({ time, message, type });
      if (logs.value.length > 100) {
        logs.value.pop();
      }
    }
    async function loadStats() {
      loading.value = true;
      try {
        const statsResponse = await api.get("/thumbnails/stats");
        const data = statsResponse.data;
        presetsList.value = data.presets || [];
        stats.value = {
          totalFiles: data.totalImages || 0,
          presets: data.totalPresets || 0,
          expectedThumbnails: data.totalExpected || 0,
          actualThumbnails: data.totalThumbnails || 0,
          missingThumbnails: data.totalMissing || 0,
          outdatedThumbnails: data.totalOutdated || 0
        };
        const outdatedMsg = stats.value.outdatedThumbnails > 0 ? `, ${stats.value.outdatedThumbnails} outdated` : "";
        addLog(`Loaded stats: ${stats.value.totalFiles} images, ${stats.value.actualThumbnails}/${stats.value.expectedThumbnails} thumbnails${outdatedMsg}`);
      } catch (err) {
        addLog(`Failed to load stats: ${err}`, "error");
      } finally {
        loading.value = false;
      }
    }
    async function checkExistingJob() {
      try {
        const response = await api.get("/thumbnails/regenerate/status");
        const data = response.data;
        if (data.status === "running") {
          addLog("Found running job, reconnecting...", "info");
          jobStartTime = new Date(data.startedAt).getTime();
          connectToSSE();
        } else if (data.status === "completed" || data.status === "cancelled" || data.status === "error") {
          const duration = data.completedAt ? Math.round((new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime()) / 1e3) : 0;
          lastResult.value = {
            generated: data.progress?.generated || 0,
            skipped: data.progress?.skipped || 0,
            errors: data.progress?.errors || 0,
            duration
          };
          if (data.status === "error") {
            addLog(`Previous job ended with error: ${data.error}`, "error");
          }
        }
      } catch {
      }
    }
    function connectToSSE() {
      if (sseAbortController) {
        sseAbortController.abort();
      }
      sseAbortController = new AbortController();
      isRunning.value = true;
      progress.value = 0;
      progressText.value = "Connecting...";
      fetch("/thumbnails/regenerate/status?sse=true", {
        credentials: "include",
        signal: sseAbortController.signal
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader)
          throw new Error("No response body");
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done)
            break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                handleSSEData(data);
              } catch {
              }
            }
          }
        }
      }).catch((err) => {
        if (err.name !== "AbortError") {
          addLog(`SSE connection failed: ${err}`, "error");
        }
      }).finally(() => {
        isRunning.value = false;
        sseAbortController = null;
      });
    }
    function handleSSEData(data) {
      if (data.status === "idle") {
        isRunning.value = false;
        return;
      }
      if (data.status === "completed" || data.status === "cancelled" || data.status === "error") {
        isRunning.value = false;
        const duration = jobStartTime ? Math.round((Date.now() - jobStartTime) / 1e3) : 0;
        lastResult.value = {
          generated: data.generated || 0,
          skipped: data.skipped || 0,
          errors: data.errors || 0,
          duration
        };
        if (data.status === "completed") {
          addLog(`Completed: ${data.generated} generated, ${data.skipped} skipped, ${data.errors} errors`, "success");
        } else if (data.status === "cancelled") {
          addLog("Job cancelled", "info");
        } else if (data.status === "error") {
          addLog(`Job failed: ${data.error}`, "error");
        }
        if (data.failed?.length) {
          for (const f of data.failed.slice(0, 10)) {
            addLog(`Error: ${f.id} - ${f.error}`, "error");
          }
          if (data.failed.length > 10) {
            addLog(`... and ${data.failed.length - 10} more errors`, "error");
          }
        }
        return;
      }
      progress.value = data.percent || 0;
      progressText.value = `Processing ${data.processed || 0}/${data.total || 0}`;
    }
    async function regenerateAll() {
      await startRegeneration({ force: forceRegenerate.value });
    }
    async function regeneratePreset(preset) {
      await startRegeneration({ preset, force: true });
    }
    async function startRegeneration(options) {
      lastResult.value = null;
      jobStartTime = Date.now();
      addLog(`Starting regeneration${options.preset ? ` for preset "${options.preset}"` : ""}...`);
      try {
        const response = await api.post("/thumbnails/regenerate", options);
        if (response.status === 409) {
          addLog("Job already running, connecting...", "info");
          connectToSSE();
          return;
        }
        const { jobId, status, total } = response.data;
        if (status === "completed") {
          addLog(response.data.message || "No files to process", "info");
          return;
        }
        addLog(`Job ${jobId} started: ${total} files`, "info");
        connectToSSE();
      } catch (err) {
        if (err.response?.status === 409) {
          addLog("Job already running, connecting...", "info");
          connectToSSE();
          return;
        }
        addLog(`Failed to start regeneration: ${err}`, "error");
      }
    }
    async function cancelOperation() {
      try {
        await api.delete("/thumbnails/regenerate").catch(() => {
        });
        await api.post("/thumbnails/cleanup/cancel").catch(() => {
        });
        addLog("Cancellation requested...", "info");
      } catch (err) {
        addLog(`Failed to cancel: ${err}`, "error");
      }
    }
    function confirmCleanup() {
      if (cleanupPreset.value) {
        showCleanupDialog.value = true;
      }
    }
    async function executeCleanup() {
      showCleanupDialog.value = false;
      if (!cleanupPreset.value)
        return;
      const presetToCleanup = cleanupPreset.value;
      cleanupPreset.value = null;
      isRunning.value = true;
      progress.value = 0;
      progressText.value = "Counting files...";
      lastResult.value = null;
      jobStartTime = Date.now();
      addLog(`Deleting thumbnails for preset "${presetToCleanup}"...`);
      if (sseAbortController) {
        sseAbortController.abort();
      }
      sseAbortController = new AbortController();
      try {
        const response = await fetch("/thumbnails/cleanup", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({
            preset: presetToCleanup,
            sse: true
          }),
          signal: sseAbortController.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader)
          throw new Error("No response body");
        const decoder = new TextDecoder();
        let buffer = "";
        let finalDeleted = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done)
            break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                progress.value = data.percent || 0;
                progressText.value = `Deleting ${data.deleted || 0}/${data.total || 0}`;
                finalDeleted = data.deleted || 0;
                if (data.status === "completed") {
                  const duration = jobStartTime ? Math.round((Date.now() - jobStartTime) / 1e3) : 0;
                  lastResult.value = {
                    generated: 0,
                    skipped: 0,
                    errors: 0,
                    duration
                  };
                  addLog(`Deleted ${finalDeleted} thumbnails for preset "${presetToCleanup}"`, "success");
                } else if (data.status === "cancelled") {
                  addLog("Cleanup cancelled", "info");
                } else if (data.status === "error") {
                  addLog(`Cleanup failed: ${data.error}`, "error");
                }
              } catch {
              }
            }
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          addLog(`Cleanup failed: ${err}`, "error");
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
        const response = await api.get("/thumbnails/cleanup/orphans");
        orphanFolders.value = response.data.orphans || [];
        if (orphanFolders.value.length === 0) {
          addLog("No orphan folders found", "info");
        } else {
          addLog(`Found ${orphanFolders.value.length} orphan folder(s)`, "info");
        }
      } catch (err) {
        addLog(`Failed to scan orphans: ${err}`, "error");
      } finally {
        scanningOrphans.value = false;
      }
    }
    async function deleteOrphan(folder) {
      isRunning.value = true;
      addLog(`Deleting orphan folder "${folder}"...`);
      try {
        const response = await api.delete(`/thumbnails/cleanup/orphan/${encodeURIComponent(folder)}`);
        const deleted = response.data.deleted || 0;
        addLog(`Deleted ${deleted} files from orphan folder "${folder}"`, "success");
        orphanFolders.value = orphanFolders.value.filter((o) => o.folder !== folder);
      } catch (err) {
        addLog(`Failed to delete orphan: ${err}`, "error");
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
    return (_ctx, _cache) => {
      const _component_v_icon = resolveComponent("v-icon");
      const _component_v_button = resolveComponent("v-button");
      const _component_v_checkbox = resolveComponent("v-checkbox");
      const _component_v_select = resolveComponent("v-select");
      const _component_v_progress_linear = resolveComponent("v-progress-linear");
      const _component_v_card_title = resolveComponent("v-card-title");
      const _component_v_card_text = resolveComponent("v-card-text");
      const _component_v_card_actions = resolveComponent("v-card-actions");
      const _component_v_card = resolveComponent("v-card");
      const _component_v_dialog = resolveComponent("v-dialog");
      const _component_private_view = resolveComponent("private-view");
      const _directive_tooltip = resolveDirective("tooltip");
      return openBlock(), createBlock(_component_private_view, { title: "Thumbnails Manager" }, {
        "title-outer:prepend": withCtx(() => [
          createVNode(_component_v_button, {
            class: "header-icon",
            rounded: "",
            disabled: "",
            icon: "",
            secondary: ""
          }, {
            default: withCtx(() => [
              createVNode(_component_v_icon, { name: "photo_size_select_large" })
            ]),
            _: 1
            /* STABLE */
          })
        ]),
        actions: withCtx(() => [
          withDirectives((openBlock(), createBlock(_component_v_button, {
            rounded: "",
            icon: "",
            secondary: "",
            disabled: loading.value,
            onClick: loadStats
          }, {
            default: withCtx(() => [
              createVNode(_component_v_icon, { name: "refresh" })
            ]),
            _: 1
            /* STABLE */
          }, 8, ["disabled"])), [
            [
              _directive_tooltip,
              "Refresh Stats",
              void 0,
              { bottom: true }
            ]
          ])
        ]),
        default: withCtx(() => [
          createElementVNode("div", _hoisted_1, [
            createCommentVNode(" Stats Section "),
            createElementVNode("div", _hoisted_2, [
              createElementVNode("div", _hoisted_3, [
                createElementVNode(
                  "div",
                  _hoisted_4,
                  toDisplayString(stats.value.totalFiles),
                  1
                  /* TEXT */
                ),
                _cache[6] || (_cache[6] = createElementVNode(
                  "div",
                  { class: "stat-label" },
                  "Total Images",
                  -1
                  /* HOISTED */
                ))
              ]),
              createElementVNode("div", _hoisted_5, [
                createElementVNode(
                  "div",
                  _hoisted_6,
                  toDisplayString(stats.value.presets),
                  1
                  /* TEXT */
                ),
                _cache[7] || (_cache[7] = createElementVNode(
                  "div",
                  { class: "stat-label" },
                  "Presets",
                  -1
                  /* HOISTED */
                ))
              ]),
              createElementVNode("div", _hoisted_7, [
                createElementVNode(
                  "div",
                  _hoisted_8,
                  toDisplayString(stats.value.actualThumbnails),
                  1
                  /* TEXT */
                ),
                _cache[8] || (_cache[8] = createElementVNode(
                  "div",
                  { class: "stat-label" },
                  "Generated Thumbnails",
                  -1
                  /* HOISTED */
                ))
              ]),
              createElementVNode(
                "div",
                {
                  class: normalizeClass(["stat-card", { "stat-warning": stats.value.missingThumbnails > 0 }])
                },
                [
                  createElementVNode(
                    "div",
                    _hoisted_9,
                    toDisplayString(stats.value.missingThumbnails),
                    1
                    /* TEXT */
                  ),
                  _cache[9] || (_cache[9] = createElementVNode(
                    "div",
                    { class: "stat-label" },
                    "Missing Thumbnails",
                    -1
                    /* HOISTED */
                  ))
                ],
                2
                /* CLASS */
              ),
              createElementVNode(
                "div",
                {
                  class: normalizeClass(["stat-card", { "stat-outdated": stats.value.outdatedThumbnails > 0 }])
                },
                [
                  createElementVNode(
                    "div",
                    _hoisted_10,
                    toDisplayString(stats.value.outdatedThumbnails),
                    1
                    /* TEXT */
                  ),
                  _cache[10] || (_cache[10] = createElementVNode(
                    "div",
                    { class: "stat-label" },
                    "Outdated Thumbnails",
                    -1
                    /* HOISTED */
                  ))
                ],
                2
                /* CLASS */
              )
            ]),
            createCommentVNode(" Presets List "),
            createElementVNode("div", _hoisted_11, [
              _cache[12] || (_cache[12] = createElementVNode(
                "h2",
                { class: "section-title" },
                "Asset Presets",
                -1
                /* HOISTED */
              )),
              presetsList.value.length === 0 ? (openBlock(), createElementBlock("div", _hoisted_12, " No presets configured. Go to Settings \u2192 Files & Storage \u2192 Storage Asset Presets. ")) : (openBlock(), createElementBlock("div", _hoisted_13, [
                (openBlock(true), createElementBlock(
                  Fragment,
                  null,
                  renderList(presetsList.value, (preset) => {
                    return openBlock(), createElementBlock(
                      "div",
                      {
                        key: preset.key,
                        class: normalizeClass(["preset-item", { "preset-outdated": preset.outdated }])
                      },
                      [
                        createElementVNode("div", _hoisted_14, [
                          createElementVNode(
                            "span",
                            _hoisted_15,
                            toDisplayString(preset.key),
                            1
                            /* TEXT */
                          ),
                          createElementVNode(
                            "span",
                            _hoisted_16,
                            toDisplayString(preset.width || "?") + "\xD7" + toDisplayString(preset.height || "?"),
                            1
                            /* TEXT */
                          ),
                          createElementVNode(
                            "span",
                            _hoisted_17,
                            toDisplayString(preset.format || "webp"),
                            1
                            /* TEXT */
                          ),
                          createElementVNode(
                            "span",
                            {
                              class: normalizeClass(["preset-count", { "preset-missing": (preset.missing || 0) > 0 }])
                            },
                            [
                              createTextVNode(
                                toDisplayString(preset.count || 0) + "/" + toDisplayString(preset.expected || 0) + " ",
                                1
                                /* TEXT */
                              ),
                              (preset.missing || 0) > 0 ? (openBlock(), createElementBlock(
                                "span",
                                _hoisted_18,
                                "-" + toDisplayString(preset.missing),
                                1
                                /* TEXT */
                              )) : createCommentVNode("v-if", true)
                            ],
                            2
                            /* CLASS */
                          ),
                          preset.outdated ? (openBlock(), createElementBlock("span", _hoisted_19, [
                            createVNode(_component_v_icon, {
                              name: "warning",
                              "x-small": ""
                            }),
                            _cache[11] || (_cache[11] = createTextVNode(" outdated "))
                          ])) : createCommentVNode("v-if", true)
                        ]),
                        createVNode(_component_v_button, {
                          small: "",
                          secondary: !preset.outdated,
                          kind: preset.outdated ? "warning" : void 0,
                          disabled: isRunning.value,
                          onClick: ($event) => regeneratePreset(preset.key)
                        }, {
                          default: withCtx(() => [
                            createTextVNode(
                              toDisplayString(preset.outdated ? "Regenerate!" : "Regenerate"),
                              1
                              /* TEXT */
                            )
                          ]),
                          _: 2
                          /* DYNAMIC */
                        }, 1032, ["secondary", "kind", "disabled", "onClick"])
                      ],
                      2
                      /* CLASS */
                    );
                  }),
                  128
                  /* KEYED_FRAGMENT */
                ))
              ]))
            ]),
            createCommentVNode(" Actions Section "),
            createElementVNode("div", _hoisted_20, [
              _cache[19] || (_cache[19] = createElementVNode(
                "h2",
                { class: "section-title" },
                "Actions",
                -1
                /* HOISTED */
              )),
              createElementVNode("div", _hoisted_21, [
                createElementVNode("div", _hoisted_22, [
                  _cache[14] || (_cache[14] = createElementVNode(
                    "h3",
                    null,
                    "Regenerate All",
                    -1
                    /* HOISTED */
                  )),
                  _cache[15] || (_cache[15] = createElementVNode(
                    "p",
                    null,
                    "Generate thumbnails for all image files using all presets.",
                    -1
                    /* HOISTED */
                  )),
                  createElementVNode("div", _hoisted_23, [
                    createVNode(_component_v_checkbox, {
                      modelValue: forceRegenerate.value,
                      "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => forceRegenerate.value = $event),
                      label: "Force (overwrite existing)"
                    }, null, 8, ["modelValue"])
                  ]),
                  createVNode(_component_v_button, {
                    disabled: isRunning.value,
                    onClick: regenerateAll
                  }, {
                    default: withCtx(() => [
                      createVNode(_component_v_icon, { name: "autorenew" }),
                      _cache[13] || (_cache[13] = createTextVNode(" Start Regeneration "))
                    ]),
                    _: 1
                    /* STABLE */
                  }, 8, ["disabled"])
                ]),
                createElementVNode("div", _hoisted_24, [
                  _cache[17] || (_cache[17] = createElementVNode(
                    "h3",
                    null,
                    "Cleanup Preset",
                    -1
                    /* HOISTED */
                  )),
                  _cache[18] || (_cache[18] = createElementVNode(
                    "p",
                    null,
                    "Delete all thumbnails for a specific preset from S3.",
                    -1
                    /* HOISTED */
                  )),
                  createVNode(_component_v_select, {
                    modelValue: cleanupPreset.value,
                    "onUpdate:modelValue": _cache[1] || (_cache[1] = ($event) => cleanupPreset.value = $event),
                    items: presetOptions.value,
                    placeholder: "Select preset..."
                  }, null, 8, ["modelValue", "items"]),
                  createVNode(_component_v_button, {
                    disabled: isRunning.value || !cleanupPreset.value,
                    secondary: "",
                    kind: "danger",
                    onClick: confirmCleanup
                  }, {
                    default: withCtx(() => [
                      createVNode(_component_v_icon, { name: "delete" }),
                      _cache[16] || (_cache[16] = createTextVNode(" Delete Thumbnails "))
                    ]),
                    _: 1
                    /* STABLE */
                  }, 8, ["disabled"])
                ])
              ])
            ]),
            createCommentVNode(" Orphan Folders Section "),
            createElementVNode("div", _hoisted_25, [
              createElementVNode("h2", _hoisted_26, [
                _cache[21] || (_cache[21] = createTextVNode(" Orphan Folders ")),
                createVNode(_component_v_button, {
                  "x-small": "",
                  secondary: "",
                  disabled: scanningOrphans.value,
                  onClick: scanOrphans
                }, {
                  default: withCtx(() => [
                    createVNode(_component_v_icon, {
                      name: "search",
                      "x-small": ""
                    }),
                    _cache[20] || (_cache[20] = createTextVNode(" Scan S3 "))
                  ]),
                  _: 1
                  /* STABLE */
                }, 8, ["disabled"])
              ]),
              scanningOrphans.value ? (openBlock(), createElementBlock("div", _hoisted_27, " Scanning S3 folders... ")) : orphanFolders.value.length === 0 ? (openBlock(), createElementBlock("div", _hoisted_28, ' No orphan folders found. Click "Scan S3" to check. ')) : (openBlock(), createElementBlock("div", _hoisted_29, [
                (openBlock(true), createElementBlock(
                  Fragment,
                  null,
                  renderList(orphanFolders.value, (orphan) => {
                    return openBlock(), createElementBlock("div", {
                      key: orphan.folder,
                      class: "orphan-item"
                    }, [
                      createElementVNode("div", _hoisted_30, [
                        createElementVNode(
                          "span",
                          _hoisted_31,
                          toDisplayString(orphan.folder),
                          1
                          /* TEXT */
                        ),
                        createElementVNode(
                          "span",
                          _hoisted_32,
                          toDisplayString(orphan.count) + " files",
                          1
                          /* TEXT */
                        )
                      ]),
                      createVNode(_component_v_button, {
                        small: "",
                        secondary: "",
                        kind: "danger",
                        disabled: isRunning.value,
                        onClick: ($event) => deleteOrphan(orphan.folder)
                      }, {
                        default: withCtx(() => _cache[22] || (_cache[22] = [
                          createTextVNode(" Delete ")
                        ])),
                        _: 2
                        /* DYNAMIC */
                      }, 1032, ["disabled", "onClick"])
                    ]);
                  }),
                  128
                  /* KEYED_FRAGMENT */
                ))
              ]))
            ]),
            createCommentVNode(" Progress Section "),
            isRunning.value || lastResult.value ? (openBlock(), createElementBlock("div", _hoisted_33, [
              _cache[24] || (_cache[24] = createElementVNode(
                "h2",
                { class: "section-title" },
                "Progress",
                -1
                /* HOISTED */
              )),
              createElementVNode("div", _hoisted_34, [
                isRunning.value ? (openBlock(), createElementBlock("div", _hoisted_35, [
                  createVNode(_component_v_progress_linear, { value: progress.value }, null, 8, ["value"]),
                  createElementVNode(
                    "div",
                    _hoisted_36,
                    toDisplayString(progressText.value),
                    1
                    /* TEXT */
                  ),
                  createVNode(_component_v_button, {
                    small: "",
                    secondary: "",
                    onClick: cancelOperation
                  }, {
                    default: withCtx(() => _cache[23] || (_cache[23] = [
                      createTextVNode(" Cancel ")
                    ])),
                    _: 1
                    /* STABLE */
                  })
                ])) : lastResult.value ? (openBlock(), createElementBlock("div", _hoisted_37, [
                  createElementVNode("div", _hoisted_38, [
                    createElementVNode("span", _hoisted_39, [
                      createVNode(_component_v_icon, {
                        name: "check_circle",
                        small: ""
                      }),
                      createTextVNode(
                        " " + toDisplayString(lastResult.value.generated) + " generated ",
                        1
                        /* TEXT */
                      )
                    ]),
                    createElementVNode("span", _hoisted_40, [
                      createVNode(_component_v_icon, {
                        name: "skip_next",
                        small: ""
                      }),
                      createTextVNode(
                        " " + toDisplayString(lastResult.value.skipped) + " skipped ",
                        1
                        /* TEXT */
                      )
                    ]),
                    lastResult.value.errors ? (openBlock(), createElementBlock("span", _hoisted_41, [
                      createVNode(_component_v_icon, {
                        name: "error",
                        small: ""
                      }),
                      createTextVNode(
                        " " + toDisplayString(lastResult.value.errors) + " errors ",
                        1
                        /* TEXT */
                      )
                    ])) : createCommentVNode("v-if", true)
                  ]),
                  createElementVNode(
                    "div",
                    _hoisted_42,
                    " Completed in " + toDisplayString(lastResult.value.duration) + "s ",
                    1
                    /* TEXT */
                  )
                ])) : createCommentVNode("v-if", true)
              ])
            ])) : createCommentVNode("v-if", true),
            createCommentVNode(" Log Section "),
            logs.value.length > 0 ? (openBlock(), createElementBlock("div", _hoisted_43, [
              createElementVNode("h2", _hoisted_44, [
                _cache[26] || (_cache[26] = createTextVNode(" Log ")),
                createVNode(_component_v_button, {
                  "x-small": "",
                  secondary: "",
                  onClick: _cache[2] || (_cache[2] = ($event) => logs.value = [])
                }, {
                  default: withCtx(() => _cache[25] || (_cache[25] = [
                    createTextVNode("Clear")
                  ])),
                  _: 1
                  /* STABLE */
                })
              ]),
              createElementVNode("div", _hoisted_45, [
                (openBlock(true), createElementBlock(
                  Fragment,
                  null,
                  renderList(logs.value, (log, i) => {
                    return openBlock(), createElementBlock(
                      "div",
                      {
                        key: i,
                        class: normalizeClass(["log-entry", log.type])
                      },
                      [
                        createElementVNode(
                          "span",
                          _hoisted_46,
                          toDisplayString(log.time),
                          1
                          /* TEXT */
                        ),
                        createElementVNode(
                          "span",
                          _hoisted_47,
                          toDisplayString(log.message),
                          1
                          /* TEXT */
                        )
                      ],
                      2
                      /* CLASS */
                    );
                  }),
                  128
                  /* KEYED_FRAGMENT */
                ))
              ])
            ])) : createCommentVNode("v-if", true)
          ]),
          createVNode(_component_v_dialog, {
            modelValue: showCleanupDialog.value,
            "onUpdate:modelValue": _cache[4] || (_cache[4] = ($event) => showCleanupDialog.value = $event),
            onEsc: _cache[5] || (_cache[5] = ($event) => showCleanupDialog.value = false)
          }, {
            default: withCtx(() => [
              createVNode(_component_v_card, null, {
                default: withCtx(() => [
                  createVNode(_component_v_card_title, null, {
                    default: withCtx(() => _cache[27] || (_cache[27] = [
                      createTextVNode("Confirm Deletion")
                    ])),
                    _: 1
                    /* STABLE */
                  }),
                  createVNode(_component_v_card_text, null, {
                    default: withCtx(() => [
                      createTextVNode(
                        ' Are you sure you want to delete all thumbnails for preset "' + toDisplayString(cleanupPreset.value) + '"? This action cannot be undone. ',
                        1
                        /* TEXT */
                      )
                    ]),
                    _: 1
                    /* STABLE */
                  }),
                  createVNode(_component_v_card_actions, null, {
                    default: withCtx(() => [
                      createVNode(_component_v_button, {
                        secondary: "",
                        onClick: _cache[3] || (_cache[3] = ($event) => showCleanupDialog.value = false)
                      }, {
                        default: withCtx(() => _cache[28] || (_cache[28] = [
                          createTextVNode("Cancel")
                        ])),
                        _: 1
                        /* STABLE */
                      }),
                      createVNode(_component_v_button, {
                        kind: "danger",
                        onClick: executeCleanup
                      }, {
                        default: withCtx(() => _cache[29] || (_cache[29] = [
                          createTextVNode("Delete")
                        ])),
                        _: 1
                        /* STABLE */
                      })
                    ]),
                    _: 1
                    /* STABLE */
                  })
                ]),
                _: 1
                /* STABLE */
              })
            ]),
            _: 1
            /* STABLE */
          }, 8, ["modelValue"])
        ]),
        _: 1
        /* STABLE */
      });
    };
  }
});

var css = "\n.module-content[data-v-a05ea388] {\n\tpadding: var(--content-padding);\n\tmax-width: 1200px;\n}\n.stats-section[data-v-a05ea388] {\n\tdisplay: grid;\n\tgrid-template-columns: repeat(auto-fit, minmax(200px, 1fr));\n\tgap: 16px;\n\tmargin-bottom: 32px;\n}\n.stat-card[data-v-a05ea388] {\n\tbackground: var(--theme--background-subdued);\n\tborder-radius: var(--theme--border-radius);\n\tpadding: 24px;\n\ttext-align: center;\n}\n.stat-value[data-v-a05ea388] {\n\tfont-size: 36px;\n\tfont-weight: 700;\n\tcolor: var(--theme--primary);\n}\n.stat-label[data-v-a05ea388] {\n\tfont-size: 14px;\n\tcolor: var(--theme--foreground-subdued);\n\tmargin-top: 4px;\n}\n.section[data-v-a05ea388] {\n\tmargin-bottom: 32px;\n}\n.section-title[data-v-a05ea388] {\n\tfont-size: 18px;\n\tfont-weight: 600;\n\tmargin-bottom: 16px;\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 12px;\n}\n.presets-list[data-v-a05ea388] {\n\tdisplay: flex;\n\tflex-direction: column;\n\tgap: 8px;\n}\n.preset-item[data-v-a05ea388] {\n\tdisplay: flex;\n\talign-items: center;\n\tjustify-content: space-between;\n\tpadding: 12px 16px;\n\tbackground: var(--theme--background-subdued);\n\tborder-radius: var(--theme--border-radius);\n}\n.preset-info[data-v-a05ea388] {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 16px;\n}\n.preset-key[data-v-a05ea388] {\n\tfont-weight: 600;\n\tmin-width: 120px;\n}\n.preset-dims[data-v-a05ea388] {\n\tcolor: var(--theme--foreground-subdued);\n\tfont-size: 14px;\n}\n.preset-format[data-v-a05ea388] {\n\tbackground: var(--theme--primary-background);\n\tcolor: var(--theme--primary);\n\tpadding: 2px 8px;\n\tborder-radius: 4px;\n\tfont-size: 12px;\n\ttext-transform: uppercase;\n}\n.preset-count[data-v-a05ea388] {\n\tcolor: var(--theme--foreground-subdued);\n\tfont-size: 14px;\n\tfont-family: var(--theme--fonts--monospace--font-family);\n}\n.preset-count.preset-missing[data-v-a05ea388] {\n\tcolor: var(--theme--warning);\n}\n.missing-badge[data-v-a05ea388] {\n\tbackground: var(--theme--warning-background);\n\tcolor: var(--theme--warning);\n\tpadding: 1px 6px;\n\tborder-radius: 4px;\n\tfont-size: 11px;\n\tmargin-left: 4px;\n}\n.outdated-badge[data-v-a05ea388] {\n\tbackground: var(--theme--danger-background);\n\tcolor: var(--theme--danger);\n\tpadding: 2px 8px;\n\tborder-radius: 4px;\n\tfont-size: 11px;\n\tmargin-left: 8px;\n\tdisplay: inline-flex;\n\talign-items: center;\n\tgap: 4px;\n}\n.preset-item.preset-outdated[data-v-a05ea388] {\n\tborder: 1px solid var(--theme--danger);\n\tbackground: var(--theme--danger-background);\n}\n.stat-card.stat-warning .stat-value[data-v-a05ea388] {\n\tcolor: var(--theme--warning);\n}\n.stat-card.stat-outdated .stat-value[data-v-a05ea388] {\n\tcolor: var(--theme--danger);\n}\n.actions-grid[data-v-a05ea388] {\n\tdisplay: grid;\n\tgrid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n\tgap: 16px;\n}\n.action-card[data-v-a05ea388] {\n\tbackground: var(--theme--background-subdued);\n\tborder-radius: var(--theme--border-radius);\n\tpadding: 24px;\n}\n.action-card h3[data-v-a05ea388] {\n\tfont-size: 16px;\n\tfont-weight: 600;\n\tmargin-bottom: 8px;\n}\n.action-card p[data-v-a05ea388] {\n\tcolor: var(--theme--foreground-subdued);\n\tfont-size: 14px;\n\tmargin-bottom: 16px;\n}\n.action-options[data-v-a05ea388] {\n\tmargin-bottom: 16px;\n}\n.progress-card[data-v-a05ea388] {\n\tbackground: var(--theme--background-subdued);\n\tborder-radius: var(--theme--border-radius);\n\tpadding: 24px;\n}\n.progress-running[data-v-a05ea388] {\n\tdisplay: flex;\n\tflex-direction: column;\n\tgap: 12px;\n}\n.progress-text[data-v-a05ea388] {\n\tfont-size: 14px;\n\tcolor: var(--theme--foreground-subdued);\n}\n.progress-result[data-v-a05ea388] {\n\tdisplay: flex;\n\tflex-direction: column;\n\tgap: 12px;\n}\n.result-stats[data-v-a05ea388] {\n\tdisplay: flex;\n\tgap: 24px;\n\tflex-wrap: wrap;\n}\n.result-item[data-v-a05ea388] {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 6px;\n\tfont-size: 14px;\n}\n.result-item.success[data-v-a05ea388] {\n\tcolor: var(--theme--success);\n}\n.result-item.skipped[data-v-a05ea388] {\n\tcolor: var(--theme--foreground-subdued);\n}\n.result-item.error[data-v-a05ea388] {\n\tcolor: var(--theme--danger);\n}\n.result-time[data-v-a05ea388] {\n\tfont-size: 12px;\n\tcolor: var(--theme--foreground-subdued);\n}\n.log-container[data-v-a05ea388] {\n\tbackground: var(--theme--background-subdued);\n\tborder-radius: var(--theme--border-radius);\n\tpadding: 16px;\n\tmax-height: 300px;\n\toverflow-y: auto;\n\tfont-family: var(--theme--fonts--monospace--font-family);\n\tfont-size: 12px;\n}\n.log-entry[data-v-a05ea388] {\n\tdisplay: flex;\n\tgap: 12px;\n\tpadding: 4px 0;\n\tborder-bottom: 1px solid var(--theme--border-color-subdued);\n}\n.log-entry[data-v-a05ea388]:last-child {\n\tborder-bottom: none;\n}\n.log-entry.success .log-message[data-v-a05ea388] {\n\tcolor: var(--theme--success);\n}\n.log-entry.error .log-message[data-v-a05ea388] {\n\tcolor: var(--theme--danger);\n}\n.log-time[data-v-a05ea388] {\n\tcolor: var(--theme--foreground-subdued);\n\tflex-shrink: 0;\n}\n.empty-state[data-v-a05ea388] {\n\tpadding: 24px;\n\ttext-align: center;\n\tcolor: var(--theme--foreground-subdued);\n\tbackground: var(--theme--background-subdued);\n\tborder-radius: var(--theme--border-radius);\n}\n.header-icon[data-v-a05ea388] {\n\t--v-button-background-color: var(--theme--primary-background);\n\t--v-button-color: var(--theme--primary);\n}\n.orphans-list[data-v-a05ea388] {\n\tdisplay: flex;\n\tflex-direction: column;\n\tgap: 8px;\n}\n.orphan-item[data-v-a05ea388] {\n\tdisplay: flex;\n\talign-items: center;\n\tjustify-content: space-between;\n\tpadding: 12px 16px;\n\tbackground: var(--theme--danger-background);\n\tborder-radius: var(--theme--border-radius);\n\tborder: 1px solid var(--theme--danger);\n}\n.orphan-info[data-v-a05ea388] {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 16px;\n}\n.orphan-name[data-v-a05ea388] {\n\tfont-weight: 600;\n\tcolor: var(--theme--danger);\n}\n.orphan-count[data-v-a05ea388] {\n\tcolor: var(--theme--foreground-subdued);\n\tfont-size: 14px;\n}\n";
n(css,{});

var ModuleComponent = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-a05ea388"], ["__file", "component.vue"]]);

var e1 = defineModule({
  id: "thumbnails-manager",
  name: "Thumbnails",
  icon: "photo_size_select_large",
  routes: [
    {
      path: "",
      component: ModuleComponent
    }
  ]
});

const interfaces = [e0];const displays = [];const layouts = [];const modules = [e1];const panels = [];const themes = [];const operations = [];

export { displays, interfaces, layouts, modules, operations, panels, themes };
