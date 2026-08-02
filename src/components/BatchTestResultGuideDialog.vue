<script setup lang="ts">
import { CircleHelp, X } from "@lucide/vue";
import { nextTick, ref, watch } from "vue";

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  close: [];
}>();

const dialog = ref<HTMLElement | null>(null);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    dialog.value?.focus();
  },
);

function close() {
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}
</script>

<template>
  <div v-if="open" class="result-guide-dialog-backdrop" @mousedown.self="close">
    <section
      ref="dialog"
      class="result-guide-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-test-result-guide-title"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header class="result-guide-dialog__header">
        <div class="result-guide-dialog__title">
          <span class="result-guide-dialog__icon"><CircleHelp :size="20" aria-hidden="true" /></span>
          <div>
            <h2 id="batch-test-result-guide-title">测试结果说明</h2>
          </div>
        </div>
        <button class="result-guide-dialog__close" type="button" title="关闭" aria-label="关闭" @click="close">
          <X :size="18" aria-hidden="true" />
        </button>
      </header>

      <section class="result-guide-dialog__section" aria-labelledby="batch-test-result-guide-categories">
        <h3 id="batch-test-result-guide-categories">各测试状态</h3>
        <div class="result-guide-dialog__table-wrap">
          <table class="result-guide-dialog__table">
            <colgroup>
              <col class="result-guide-dialog__status-column" />
              <col />
              <col class="result-guide-dialog__response-column" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">状态</th>
                <th scope="col">说明</th>
                <th scope="col">返回码</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" class="result-guide-dialog__status result-guide-dialog__status--success">正常</th>
                <td>本次请求已成功完成，说明账号可以通过当前选择的模型完成这一次测试。它只反映当前时刻，之后仍可能受到额度、网络或平台状态变化影响。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>200</code></span></td>
              </tr>
              <tr>
                <th scope="row" class="result-guide-dialog__status result-guide-dialog__status--quota">限流中</th>
                <td>服务端返回限流或额度限制。账号不一定失效，可以等待限制恢复、调整请求频率或检查余额和配额后再测试。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>429</code><code>usage_limit_reached</code></span></td>
              </tr>
              <tr>
                <th scope="rowgroup" rowspan="10" class="result-guide-dialog__status result-guide-dialog__status--interrupted">
                  <span>连接异常</span>
                  <small class="result-guide-dialog__status-note">（可能仍为正常账号，建议重试，勿轻易删除）</small>
                </th>
                <td>测试请求参数或服务端校验未通过。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>400</code></span></td>
              </tr>
              <tr>
                <td>权限、地区、IP 白名单或访问限制导致请求被拒绝，不一定表示账号失效。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>403</code></span></td>
              </tr>
              <tr>
                <td>测试接口或账号资源未找到，可能与 Sub2API 版本、接口路径或账号数据变化有关。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>404</code></span></td>
              </tr>
              <tr>
                <td>上游在规定时间内没有完成响应，可稍后重新测试。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>408</code></span></td>
              </tr>
              <tr>
                <td>账号当前状态冲突，或服务端无法接受这一次测试请求。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>409</code><code>422</code></span></td>
              </tr>
              <tr>
                <td>Sub2API、上游平台或中转服务暂时异常，稍后重试通常更合适。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>500</code><code>502</code><code>503</code><code>504</code></span></td>
              </tr>
              <tr>
                <td>90 秒内没有收到最终测试结果。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>超时</code></span></td>
              </tr>
              <tr>
                <td>连接被关闭，或 SSE 没有发送最终结果。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>EOF</code><code>流提前结束</code></span></td>
              </tr>
              <tr>
                <td>网络、代理、DNS、TLS 证书或连接套接字出现问题。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>网络错误</code></span></td>
              </tr>
              <tr>
                <td>未取得可识别的状态码或网络错误文本；可将鼠标悬停在账号表的测试结果上查看原始信息。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>未知原因</code></span></td>
              </tr>
              <tr>
                <th scope="row" class="result-guide-dialog__status result-guide-dialog__status--failure">错误</th>
                <td>管理会话授权被拒绝。系统会先尝试刷新 Sub2API 管理会话并重试一次，仍失败才记为错误；请检查登录令牌、权限、组织或 IP 配置。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>401</code></span></td>
              </tr>
              <tr>
                <th scope="row" class="result-guide-dialog__status result-guide-dialog__status--inactive">停用</th>
                <td>账号在批量开始时已经处于停用状态。这是原有状态的快照，不等同于本次测试失败。</td>
                <td class="result-guide-dialog__code"><span class="result-guide-dialog__code-list"><code>inactive</code></span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <footer class="result-guide-dialog__actions">
        <button class="button button--primary" type="button" @click="close">关闭</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.result-guide-dialog-backdrop { position: fixed; z-index: 60; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 42%, transparent); }
.result-guide-dialog { width: min(100%, 840px); max-height: var(--dialog-content-max-height); overflow-y: auto; padding: 20px; color: var(--text); border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.result-guide-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.result-guide-dialog__title { display: flex; align-items: flex-start; min-width: 0; gap: 11px; }
.result-guide-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; color: var(--info); border-radius: 7px; background: var(--cyan-subtle); }
.result-guide-dialog__title h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.result-guide-dialog__close { display: inline-grid; flex: 0 0 auto; place-items: center; width: 30px; height: 30px; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.result-guide-dialog__close:hover, .result-guide-dialog__close:focus-visible { color: var(--ink); background: var(--surface-hover); outline: 0; }
.result-guide-dialog__section { margin-top: 19px; }
.result-guide-dialog__section h3 { margin: 0; color: var(--heading); font-size: 14px; line-height: 1.4; }
.result-guide-dialog__table-wrap { margin-top: 10px; overflow: hidden; border: 1px solid var(--divider); border-radius: 6px; }
.result-guide-dialog__table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.result-guide-dialog__status-column { width: 86px; }
.result-guide-dialog__response-column { width: 190px; }
.result-guide-dialog__table th, .result-guide-dialog__table td { min-width: 0; padding: 9px 10px; border-bottom: 1px solid var(--divider); font-size: 13px; line-height: 1.58; overflow-wrap: anywhere; vertical-align: middle; }
.result-guide-dialog__table thead th { color: var(--muted); background: var(--surface-subtle); font-size: 12px; font-weight: 700; text-align: left; }
.result-guide-dialog__table thead th + th, .result-guide-dialog__table tbody td { border-left: 1px solid var(--divider); }
.result-guide-dialog__table tbody th { text-align: left; }
.result-guide-dialog__table tbody td { color: var(--text); }
.result-guide-dialog__table tbody tr:last-child th, .result-guide-dialog__table tbody tr:last-child td { border-bottom: 0; }
.result-guide-dialog__code-list { display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 4px; }
.result-guide-dialog__status { font-size: 13px; font-weight: 700; line-height: 1.58; }
.result-guide-dialog__status--success { color: var(--brand); }
.result-guide-dialog__status--quota { color: var(--warning); }
.result-guide-dialog__status--interrupted { color: var(--info); vertical-align: top !important; }
.result-guide-dialog__status-note { display: block; margin-top: 5px; color: var(--muted); font-size: 11px; font-weight: 500; line-height: 1.55; }
.result-guide-dialog__status--failure { color: var(--danger); }
.result-guide-dialog__status--inactive { color: var(--muted); }
.result-guide-dialog code { padding: 1px 3px; color: var(--text-strong); border: 1px solid var(--divider); border-radius: 3px; background: var(--surface-subtle); font: inherit; font-variant-numeric: tabular-nums; }
.result-guide-dialog__actions { display: flex; justify-content: flex-end; margin-top: 22px; gap: 8px; }
@media (max-width: 580px) { .result-guide-dialog__status-column { width: 74px; } .result-guide-dialog__response-column { width: 136px; } .result-guide-dialog__table th, .result-guide-dialog__table td { padding: 8px; } }
@media (max-width: 440px) { .result-guide-dialog-backdrop { align-items: end; padding: 12px; } .result-guide-dialog { padding: 17px; } .result-guide-dialog__status-column { width: 64px; } .result-guide-dialog__response-column { width: 103px; } .result-guide-dialog__table th, .result-guide-dialog__table td { padding: 7px 6px; font-size: 12px; } }
</style>
