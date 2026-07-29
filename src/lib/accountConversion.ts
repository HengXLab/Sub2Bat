import { strToU8, zipSync } from "fflate";

export type AccountConversionMode = "cpaToSub2api" | "sub2apiToCpa";

export const MAX_CONVERSION_RECORDS = 10_000;
export const MAX_CONVERSION_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_PASTED_CONVERSION_CHARACTERS = 10 * 1024 * 1024;
export const MAX_PASTED_CONVERSION_DOCUMENTS = 12_000;
export const MAX_PASTED_CONVERSION_ISSUES = 2_000;

type JsonRecord = Record<string, unknown>;

export interface ConversionRecord {
  sourceName: string;
  sourceType: "codex" | "claude" | "antigravity" | "gemini";
  providerLabel: string;
  email?: string;
  planType?: string;
  expiresAt?: string;
  entryLabel?: string;
  account?: JsonRecord;
  document: JsonRecord;
  outputFileName: string;
}

export interface ConversionIssue {
  sourceName: string;
  entryLabel?: string;
  reason: string;
}

export interface ConversionResult {
  converted: ConversionRecord[];
  skipped: ConversionIssue[];
}

export interface PastedJsonResult {
  documents: unknown[];
  issues: ConversionIssue[];
  issueCount: number;
  issuesTruncated: boolean;
}

export interface PastedInputItem {
  sourceName: string;
  document: unknown;
}

interface ConversionOptions {
  now?: Date;
  sourceName?: string;
}

interface ParsedCpaAccount {
  providerLabel: string;
  platform: "openai" | "anthropic" | "antigravity" | "gemini";
  email?: string;
  planType?: string;
  expiresAt?: string;
  credentials: JsonRecord;
  extra: JsonRecord;
}

const CPA_EXTENSION = ".cpa.json";

// Compatible with the public MIT CPA2sub2API conversion convention. All data stays local.
export function convertCpaRecord(record: unknown, options: ConversionOptions = {}): ConversionRecord {
  const source = requireRecord(record, "文件不是 JSON 对象。");
  const rawType = firstText(source.type);
  const sourceType = rawType ? normalizeCpaType(rawType) : "codex";
  if (!sourceType) {
    throw new Error(`暂不支持 type=${rawType} 的 CPA 文件。`);
  }
  const now = validDate(options.now) ?? new Date();

  let parsed: ParsedCpaAccount;
  switch (sourceType) {
    case "codex":
      parsed = parseCodexCpa(source, now);
      break;
    case "claude":
      parsed = parseClaudeCpa(source);
      break;
    case "antigravity":
      parsed = parseAntigravityCpa(source);
      break;
    case "gemini":
      parsed = parseGeminiCpa(source);
      break;
  }

  const accountName = firstText(parsed.email, lastPathPart(options.sourceName || ""), "converted-account")!;
  const account = compactRecord([
    ["name", accountName],
    ["platform", parsed.platform],
    ["type", "oauth"],
    ["concurrency", 10],
    ["priority", 1],
    ["credentials", parsed.credentials],
    ["extra", parsed.extra],
  ]);
  const document = compactRecord([
    ["exported_at", now.toISOString()],
    ["proxies", []],
    ["accounts", [account]],
  ]);

  return {
    sourceName: options.sourceName ?? "",
    sourceType,
    providerLabel: parsed.providerLabel,
    email: parsed.email,
    planType: parsed.planType,
    expiresAt: parsed.expiresAt,
    account,
    document,
    outputFileName: buildSub2apiFileName(options.sourceName, parsed.email),
  };
}

export function convertSub2apiDocument(document: unknown, options: ConversionOptions = {}): ConversionResult {
  const accounts = extractSub2apiAccounts(document);
  if (!accounts.length) {
    throw new Error("Sub2API 配置中的 accounts 为空。");
  }
  if (accounts.length > MAX_CONVERSION_RECORDS) {
    throw new Error(`单个配置最多转换 ${MAX_CONVERSION_RECORDS.toLocaleString()} 个账号。请拆分文件后重试。`);
  }

  const converted: ConversionRecord[] = [];
  const skipped: ConversionIssue[] = [];

  accounts.forEach((rawAccount, index) => {
    const entryLabel = sub2apiEntryLabel(rawAccount, index);
    try {
      const item = convertSub2apiAccount(rawAccount, options);
      converted.push({
        ...item,
        sourceName: options.sourceName ?? "",
        entryLabel,
      });
    } catch (error) {
      skipped.push({
        sourceName: options.sourceName ?? "",
        entryLabel,
        reason: readableError(error),
      });
    }
  });

  return { converted, skipped };
}

export function buildMergedSub2apiDocument(records: readonly ConversionRecord[], now = new Date()): JsonRecord {
  ensureConversionRecordLimit(records);
  return compactRecord([
    ["exported_at", (validDate(now) ?? new Date()).toISOString()],
    ["proxies", []],
    ["accounts", records.map((record) => record.account).filter((account): account is JsonRecord => Boolean(account))],
  ]);
}

export function createConversionZip(records: readonly ConversionRecord[]): Uint8Array {
  ensureConversionRecordLimit(records);
  const files: Record<string, Uint8Array> = {};
  const names = new Set<string>();
  let totalBytes = 0;

  records.forEach((record, index) => {
    const fileName = uniqueFileName(record.outputFileName || `converted-${index + 1}.json`, names);
    const serialized = `${JSON.stringify(record.document, null, 2)}\n`;
    const serializedBytes = utf8ByteLength(serialized);
    if (serializedBytes > MAX_CONVERSION_ARCHIVE_BYTES - totalBytes) {
      throw new Error(`转换结果超过 ${formatMegabytes(MAX_CONVERSION_ARCHIVE_BYTES)} MB 上限。请分批导出。`);
    }
    totalBytes += serializedBytes;
    const contents = strToU8(serialized);
    files[fileName] = contents;
  });

  if (!Object.keys(files).length) {
    throw new Error("没有可导出的转换结果。");
  }

  const archive = zipSync(files, { level: 6 });
  if (archive.byteLength > MAX_CONVERSION_ARCHIVE_BYTES) {
    throw new Error(`转换压缩包超过 ${formatMegabytes(MAX_CONVERSION_ARCHIVE_BYTES)} MB 上限。请分批导出。`);
  }
  return archive;
}

export function conversionTimestampedFileName(prefix: "sub2api" | "cpa", extension: "json" | "zip", date = new Date()): string {
  const timestamp = validDate(date) ?? new Date();
  const token = `${timestamp.getFullYear()}-${pad2(timestamp.getMonth() + 1)}-${pad2(timestamp.getDate())}_${pad2(timestamp.getHours())}-${pad2(timestamp.getMinutes())}-${pad2(timestamp.getSeconds())}`;
  return `${prefix}-${token}.${extension}`;
}

export function parsePastedJsonDocuments(text: string): PastedJsonResult {
  const input = String(text || "");
  if (input.length > MAX_PASTED_CONVERSION_CHARACTERS) {
    return {
      documents: [],
      issues: [{ sourceName: pastedLabel(0), reason: `粘贴内容超过 ${formatMegabytes(MAX_PASTED_CONVERSION_CHARACTERS)} MB 上限。请改用拆分后的文件导入。` }],
      issueCount: 1,
      issuesTruncated: false,
    };
  }
  const documents: unknown[] = [];
  const issues: ConversionIssue[] = [];
  let issueCount = 0;
  let issuesTruncated = false;
  const appendIssue = (issue: ConversionIssue) => {
    issueCount += 1;
    if (issues.length < MAX_PASTED_CONVERSION_ISSUES) {
      issues.push(issue);
    } else {
      issuesTruncated = true;
    }
  };
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let documentIndex = 0;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (start === -1) {
      if (/\s/u.test(character)) continue;
      if (character !== "{" && character !== "[") {
        appendIssue({
          sourceName: pastedLabel(documentIndex),
          reason: `JSON 文档必须以 { 或 [ 开始，当前位置是 ${JSON.stringify(character)}。`,
        });
        break;
      }
      start = index;
      depth = 1;
      inString = false;
      escaped = false;
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }
    if (character !== "}" && character !== "]") continue;

    depth -= 1;
    if (depth !== 0) continue;

    if (documents.length >= MAX_PASTED_CONVERSION_DOCUMENTS) {
      appendIssue({
        sourceName: pastedLabel(documentIndex),
        reason: `粘贴内容最多解析 ${MAX_PASTED_CONVERSION_DOCUMENTS.toLocaleString()} 个 JSON 文档。`,
      });
      break;
    }

    const candidate = input.slice(start, index + 1);
    try {
      documents.push(JSON.parse(candidate) as unknown);
    } catch (error) {
      appendIssue({ sourceName: pastedLabel(documentIndex), reason: `JSON 解析失败：${readableError(error)}` });
    }
    documentIndex += 1;
    start = -1;
  }

  if (start !== -1) {
    appendIssue({ sourceName: pastedLabel(documentIndex), reason: "JSON 不完整：缺少顶层闭合括号。" });
  }
  if (!documents.length && !issues.length && input.trim()) {
    appendIssue({ sourceName: pastedLabel(0), reason: "没有找到可解析的 JSON 文档。" });
  }

  return { documents, issues, issueCount, issuesTruncated };
}

export function buildPastedInputItems(
  documents: readonly unknown[],
  mode: AccountConversionMode,
  maximum = MAX_PASTED_CONVERSION_DOCUMENTS,
): PastedInputItem[] {
  const items: PastedInputItem[] = [];
  for (const [index, document] of documents.entries()) {
    if (items.length >= maximum) break;
    if (mode === "cpaToSub2api" && Array.isArray(document)) {
      for (const [itemIndex, item] of document.entries()) {
        if (items.length >= maximum) break;
        items.push({ document: item, sourceName: pastedLabel(index, `.${itemIndex + 1}`) });
      }
    } else {
      items.push({ document, sourceName: pastedLabel(index) });
    }
  }
  return items;
}

function parseCodexCpa(record: JsonRecord, now: Date): ParsedCpaAccount {
  const accessToken = requireText(record.access_token, "缺少 access_token。");
  const idToken = requireText(record.id_token, "缺少 id_token。");
  const accessPayload = parseJwtPayload(accessToken, "access_token 不是有效 JWT。");
  const idPayload = parseJwtPayload(idToken, "id_token 不是有效 JWT。");
  const accessAuth = openaiSection(accessPayload, "https://api.openai.com/auth");
  const idAuth = openaiSection(idPayload, "https://api.openai.com/auth");
  const accessProfile = openaiSection(accessPayload, "https://api.openai.com/profile");
  const email = firstText(record.email, accessProfile?.email, accessPayload.email, idPayload.email);
  const expiresAt = firstText(
    normalizeFlexibleTimestamp(record.expired),
    timestampFromUnixSeconds(finiteNumber(accessPayload.exp)),
  );
  const planType = firstText(record.plan_type, accessAuth?.chatgpt_plan_type, idAuth?.chatgpt_plan_type);

  return {
    providerLabel: "Codex / OpenAI",
    platform: "openai",
    email,
    planType,
    expiresAt,
    credentials: compactRecord([
      ["access_token", accessToken],
      ["chatgpt_account_id", firstText(record.account_id, accessAuth?.chatgpt_account_id, idAuth?.chatgpt_account_id)],
      ["chatgpt_user_id", firstText(accessAuth?.chatgpt_user_id, idAuth?.chatgpt_user_id, accessAuth?.user_id, idAuth?.user_id)],
      ["email", email],
      ["expires_at", expiresAt],
      ["expires_in", expiresIn(expiresAt, now)],
      ["id_token", idToken],
      ["organization_id", organizationId(idAuth, accessAuth)],
      ["plan_type", planType],
      ["refresh_token", firstText(record.refresh_token)],
    ]),
    extra: commonExtra(record, email),
  };
}

function parseClaudeCpa(record: JsonRecord): ParsedCpaAccount {
  const accessToken = requireText(record.access_token, "缺少 access_token。");
  const email = firstText(record.email);
  const expiresAt = normalizeFlexibleTimestamp(record.expired);
  return {
    providerLabel: "Claude",
    platform: "anthropic",
    email,
    expiresAt,
    credentials: compactRecord([
      ["access_token", accessToken],
      ["email_address", email],
      ["expires_at", timestampSeconds(expiresAt)],
      ["id_token", firstText(record.id_token)],
      ["refresh_token", firstText(record.refresh_token)],
    ]),
    extra: commonExtra(record, email),
  };
}

function parseAntigravityCpa(record: JsonRecord): ParsedCpaAccount {
  const accessToken = requireText(record.access_token, "缺少 access_token。");
  const expiresAt = firstText(
    normalizeFlexibleTimestamp(record.expired),
    timestampFromEpochAndDuration(record.timestamp, record.expires_in),
  );
  const email = firstText(record.email);
  const planType = firstText(record.plan_type);
  return {
    providerLabel: "Antigravity",
    platform: "antigravity",
    email,
    planType,
    expiresAt,
    credentials: compactRecord([
      ["access_token", accessToken],
      ["email", email],
      ["expires_at", timestampSeconds(expiresAt)],
      ["expires_in", finiteNumber(record.expires_in)],
      ["project_id", firstText(record.project_id)],
      ["refresh_token", firstText(record.refresh_token)],
      ["token_type", firstText(record.token_type)],
      ["plan_type", planType],
    ]),
    extra: commonExtra(record, email),
  };
}

function parseGeminiCpa(record: JsonRecord): ParsedCpaAccount {
  const token = requireRecord(record.token, "缺少 token 对象。");
  const accessToken = requireText(firstText(token.access_token, token.accessToken), "token 中缺少 access_token。");
  const expiresAt = firstText(
    normalizeFlexibleTimestamp(token.expiry),
    normalizeFlexibleTimestamp(token.expires_at),
    normalizeFlexibleTimestamp(token.expiration),
    timestampFromUnixSeconds(finiteNumber(token.expires_in_abs)),
  );
  const email = firstText(record.email);
  const projectId = firstText(record.project_id);
  const extra = commonExtra(record, email);
  if (typeof record.auto === "boolean") extra.auto = record.auto;
  if (typeof record.checked === "boolean") extra.checked = record.checked;
  return {
    providerLabel: "Gemini",
    platform: "gemini",
    email,
    expiresAt,
    credentials: compactRecord([
      ["access_token", accessToken],
      ["expires_at", timestampSeconds(expiresAt)],
      ["oauth_type", projectId ? "code_assist" : undefined],
      ["project_id", projectId],
      ["refresh_token", firstText(token.refresh_token, token.refreshToken)],
      ["scope", joinScopes(token.scope ?? token.scopes)],
      ["token_type", firstText(token.token_type, token.tokenType)],
    ]),
    extra,
  };
}

function convertSub2apiAccount(rawAccount: unknown, options: ConversionOptions): Omit<ConversionRecord, "sourceName" | "entryLabel"> {
  const account = requireRecord(rawAccount, "account 不是对象。");
  const type = firstText(account.type)?.toLocaleLowerCase();
  if (type && type !== "oauth") {
    throw new Error(`暂不支持 type=${firstText(account.type)} 的 Sub2API 账号。`);
  }

  const platform = normalizeSub2apiPlatform(account.platform);
  switch (platform) {
    case "codex":
      return convertSub2apiCodex(account, options);
    case "claude":
      return convertSub2apiClaude(account, options);
    case "antigravity":
      return convertSub2apiAntigravity(account, options);
    case "gemini":
      return convertSub2apiGemini(account);
    default:
      throw new Error(`暂不支持 platform=${firstText(account.platform) || "未填写"} 的 Sub2API 账号。`);
  }
}

function convertSub2apiCodex(account: JsonRecord, options: ConversionOptions): Omit<ConversionRecord, "sourceName" | "entryLabel"> {
  const credentials = sub2apiCredentials(account);
  const extra = sub2apiExtra(account);
  const accessToken = requireText(credentials.access_token, "credentials.access_token 为空。");
  const idToken = requireText(credentials.id_token, "credentials.id_token 为空，无法生成 Codex CPA 文件。");
  const payload = parseJwtPayload(accessToken);
  const expiresAt = firstText(
    normalizeFlexibleTimestamp(credentials.expires_at),
    payload ? timestampFromUnixSeconds(finiteNumber(payload.exp)) : undefined,
    timestampFromNowPlusSeconds(credentials.expires_in, options.now),
    normalizeFlexibleTimestamp(account.expires_at),
  );
  const email = firstText(extra.email, credentials.email);
  const planType = firstText(credentials.plan_type);
  const document = compactRecord([
    ["type", "codex"],
    ["access_token", accessToken],
    ["id_token", idToken],
    ["account_id", firstText(credentials.chatgpt_account_id, credentials.account_id)],
    ["email", email],
    ["expired", expiresAt],
    ["last_refresh", normalizeFlexibleTimestamp(extra.last_refresh)],
    ["plan_type", planType],
  ]);
  // CPA expects this key even when a Codex account has no refresh token.
  document.refresh_token = firstText(credentials.refresh_token) ?? "";
  return {
    sourceType: "codex",
    providerLabel: "Codex / OpenAI",
    email,
    planType,
    expiresAt,
    document,
    outputFileName: buildCpaFileName(firstText(account.name), email, "codex"),
  };
}

function convertSub2apiClaude(account: JsonRecord, options: ConversionOptions): Omit<ConversionRecord, "sourceName" | "entryLabel"> {
  const credentials = sub2apiCredentials(account);
  const extra = sub2apiExtra(account);
  const accessToken = requireText(credentials.access_token, "credentials.access_token 为空。");
  const email = firstText(extra.email, credentials.email_address, credentials.email);
  const expiresAt = firstText(
    normalizeFlexibleTimestamp(credentials.expires_at),
    timestampFromNowPlusSeconds(credentials.expires_in, options.now),
    normalizeFlexibleTimestamp(account.expires_at),
  );
  const document = compactRecord([
    ["type", "claude"],
    ["access_token", accessToken],
    ["email", email],
    ["expired", expiresAt],
    ["id_token", firstText(credentials.id_token)],
    ["last_refresh", normalizeFlexibleTimestamp(extra.last_refresh)],
    ["refresh_token", firstText(credentials.refresh_token)],
  ]);
  return {
    sourceType: "claude",
    providerLabel: "Claude",
    email,
    expiresAt,
    document,
    outputFileName: buildCpaFileName(firstText(account.name), email, "claude"),
  };
}

function convertSub2apiAntigravity(account: JsonRecord, options: ConversionOptions): Omit<ConversionRecord, "sourceName" | "entryLabel"> {
  const credentials = sub2apiCredentials(account);
  const extra = sub2apiExtra(account);
  const accessToken = requireText(credentials.access_token, "credentials.access_token 为空。");
  const email = firstText(extra.email, credentials.email);
  const planType = firstText(credentials.plan_type, credentials.chatgpt_plan_type);
  const expiresAt = firstText(
    normalizeFlexibleTimestamp(credentials.expires_at),
    timestampFromNowPlusSeconds(credentials.expires_in, options.now),
    normalizeFlexibleTimestamp(account.expires_at),
  );
  const document = compactRecord([
    ["type", "antigravity"],
    ["access_token", accessToken],
    ["email", email],
    ["expired", expiresAt],
    ["expires_in", finiteNumber(credentials.expires_in)],
    ["last_refresh", normalizeFlexibleTimestamp(extra.last_refresh)],
    ["plan_type", planType],
    ["project_id", firstText(credentials.project_id)],
    ["refresh_token", firstText(credentials.refresh_token)],
    ["token_type", firstText(credentials.token_type)],
  ]);
  return {
    sourceType: "antigravity",
    providerLabel: "Antigravity",
    email,
    planType,
    expiresAt,
    document,
    outputFileName: buildCpaFileName(firstText(account.name), email, "antigravity"),
  };
}

function convertSub2apiGemini(account: JsonRecord): Omit<ConversionRecord, "sourceName" | "entryLabel"> {
  const credentials = sub2apiCredentials(account);
  const extra = sub2apiExtra(account);
  const accessToken = requireText(credentials.access_token, "credentials.access_token 为空。");
  const email = firstText(extra.email, credentials.email);
  const expiresAt = firstText(
    normalizeFlexibleTimestamp(credentials.expires_at),
    normalizeFlexibleTimestamp(account.expires_at),
  );
  const token = compactRecord([
    ["access_token", accessToken],
    ["expiry", expiresAt],
    ["refresh_token", firstText(credentials.refresh_token)],
    ["scope", joinScopes(credentials.scope)],
    ["token_type", firstText(credentials.token_type)],
  ]);
  const document = compactRecord([
    ["type", "gemini"],
    ["checked", typeof extra.checked === "boolean" ? extra.checked : undefined],
    ["auto", typeof extra.auto === "boolean" ? extra.auto : undefined],
    ["email", email],
    ["last_refresh", normalizeFlexibleTimestamp(extra.last_refresh)],
    ["project_id", firstText(credentials.project_id)],
    ["token", token],
  ]);
  return {
    sourceType: "gemini",
    providerLabel: "Gemini",
    email,
    expiresAt,
    document,
    outputFileName: buildCpaFileName(firstText(account.name), email, "gemini"),
  };
}

function extractSub2apiAccounts(document: unknown): unknown[] {
  if (Array.isArray(document)) return document;
  if (!isRecord(document)) {
    throw new Error("不是有效的 Sub2API 配置，缺少 accounts 数组。");
  }
  if (Array.isArray(document.accounts)) return document.accounts;
  if (typeof document.platform === "string" && isRecord(document.credentials)) return [document];
  throw new Error("不是有效的 Sub2API 配置，缺少 accounts 数组。");
}

function sub2apiCredentials(account: JsonRecord): JsonRecord {
  return requireRecord(account.credentials, "缺少 account.credentials 对象。");
}

function sub2apiExtra(account: JsonRecord): JsonRecord {
  return isRecord(account.extra) ? account.extra : {};
}

function sub2apiEntryLabel(value: unknown, index: number): string {
  if (!isRecord(value)) return `accounts[${index}]`;
  const credentials = isRecord(value.credentials) ? value.credentials : {};
  const extra = isRecord(value.extra) ? value.extra : {};
  return firstText(value.name, extra.email, credentials.email, credentials.email_address, `accounts[${index}]`)!;
}

function normalizeCpaType(value: unknown): "codex" | "claude" | "antigravity" | "gemini" | undefined {
  switch (firstText(value)?.toLocaleLowerCase()) {
    case "codex":
      return "codex";
    case "claude":
      return "claude";
    case "antigravity":
      return "antigravity";
    case "gemini":
      return "gemini";
    default:
      return undefined;
  }
}

function normalizeSub2apiPlatform(value: unknown): "codex" | "claude" | "antigravity" | "gemini" | undefined {
  switch (firstText(value)?.toLocaleLowerCase()) {
    case "openai":
    case "codex":
      return "codex";
    case "anthropic":
    case "claude":
      return "claude";
    case "antigravity":
      return "antigravity";
    case "gemini":
      return "gemini";
    default:
      return undefined;
  }
}

function parseJwtPayload(token: string): JsonRecord | undefined;
function parseJwtPayload(token: string, failureMessage: string): JsonRecord;
function parseJwtPayload(token: string, failureMessage?: string): JsonRecord | undefined {
  const segments = token.split(".");
  if (segments.length < 2) {
    if (failureMessage) throw new Error(failureMessage);
    return undefined;
  }
  try {
    const normalized = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isRecord(payload)) throw new Error("payload is not an object");
    return payload;
  } catch {
    if (failureMessage) throw new Error(failureMessage);
    return undefined;
  }
}

function openaiSection(payload: JsonRecord, key: string): JsonRecord | undefined {
  return isRecord(payload[key]) ? payload[key] : undefined;
}

function organizationId(...sources: Array<JsonRecord | undefined>): string | undefined {
  for (const source of sources) {
    if (!source || !Array.isArray(source.organizations)) continue;
    const organizations = source.organizations.filter(isRecord);
    const preferred = organizations.find((organization) => Boolean(organization.is_default) && firstText(organization.id));
    const fallback = organizations.find((organization) => firstText(organization.id));
    const id = firstText(preferred?.id, fallback?.id);
    if (id) return id;
  }
  return undefined;
}

function commonExtra(record: JsonRecord, email: string | undefined): JsonRecord {
  return compactRecord([
    ["email", email],
    ["email_key", emailKey(email)],
    ["last_refresh", normalizeFlexibleTimestamp(record.last_refresh)],
  ]);
}

function emailKey(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function normalizeFlexibleTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return timestampFromUnixLike(value);
  if (typeof value !== "string" || !value.trim()) return undefined;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  return timestampFromUnixLike(Number(value));
}

function timestampFromUnixLike(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const milliseconds = Math.abs(value) > 100_000_000_000 ? value : value * 1_000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timestampFromUnixSeconds(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timestampFromEpochAndDuration(timestamp: unknown, duration: unknown): string | undefined {
  const epoch = finiteNumber(timestamp);
  const seconds = finiteNumber(duration);
  if (epoch === undefined || seconds === undefined) return undefined;
  const milliseconds = Math.abs(epoch) > 100_000_000_000 ? epoch : epoch * 1_000;
  const date = new Date(milliseconds + (seconds * 1_000));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timestampFromNowPlusSeconds(value: unknown, now: Date | undefined): string | undefined {
  const seconds = finiteNumber(value);
  if (seconds === undefined) return undefined;
  const base = validDate(now) ?? new Date();
  const date = new Date(base.getTime() + (seconds * 1_000));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timestampSeconds(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : String(Math.floor(date.getTime() / 1_000));
}

function expiresIn(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const expiresAt = new Date(value).getTime();
  return Number.isNaN(expiresAt) ? undefined : Math.max(0, Math.floor((expiresAt - now.getTime()) / 1_000));
}

function joinScopes(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return undefined;
  const scopes = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  return scopes.length ? scopes.join(" ") : undefined;
}

function buildSub2apiFileName(sourceName: string | undefined, email: string | undefined): string {
  const sourceBase = cleanFileBase(lastPathPart(sourceName || ""));
  const emailBase = cleanFileBase(email || "");
  return `${sourceBase || emailBase || "converted-account"}.sub2api.json`;
}

function buildCpaFileName(accountName: string | undefined, email: string | undefined, provider: string): string {
  const base = cleanFileBase(firstText(email, accountName, provider, "converted-account")!);
  const type = cleanFileBase(provider) || "account";
  return !base || base === type ? `${type}${CPA_EXTENSION}` : `${base}.${type}${CPA_EXTENSION}`;
}

function uniqueFileName(fileName: string, names: Set<string>): string {
  const cpaExtension = ".cpa.json";
  const dot = fileName.lastIndexOf(".");
  const hasCpaExtension = fileName.toLocaleLowerCase().endsWith(cpaExtension);
  const base = hasCpaExtension ? fileName.slice(0, -cpaExtension.length) : (dot > 0 ? fileName.slice(0, dot) : fileName);
  const extension = hasCpaExtension ? cpaExtension : (dot > 0 ? fileName.slice(dot) : "");
  let candidate = fileName;
  let index = 2;
  while (names.has(candidate.toLocaleLowerCase())) {
    candidate = `${base}-${index}${extension}`;
    index += 1;
  }
  names.add(candidate.toLocaleLowerCase());
  return candidate;
}

function cleanFileBase(value: string): string {
  return value
    .replace(/\.[^.]+$/u, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase();
}

function lastPathPart(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function pastedLabel(index: number, suffix = ""): string {
  return `粘贴内容 #${index + 1}${suffix}`;
}

function compactRecord(entries: ReadonlyArray<readonly [string, unknown]>): JsonRecord {
  const record: JsonRecord = {};
  for (const [key, rawValue] of entries) {
    const value = compactValue(rawValue);
    if (value !== undefined) record[key] = value;
  }
  return record;
}

function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactValue).filter((item) => item !== undefined);
  if (isRecord(value)) {
    const compacted = compactRecord(Object.entries(value));
    return Object.keys(compacted).length ? compacted : undefined;
  }
  return value === undefined || value === null || value === "" ? undefined : value;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function requireText(value: unknown, message: string): string {
  const text = firstText(value);
  if (!text) throw new Error(message);
  return text;
}

function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: Date | undefined): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "无法解析该内容。";
}

function ensureConversionRecordLimit(records: readonly ConversionRecord[]) {
  if (records.length > MAX_CONVERSION_RECORDS) {
    throw new Error(`一次最多导出 ${MAX_CONVERSION_RECORDS.toLocaleString()} 个转换结果。请分批处理。`);
  }
}

function formatMegabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
