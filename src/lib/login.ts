export interface LoginFields {
  serverUrl: string;
  email: string;
  password: string;
}

export function validateLogin(fields: LoginFields): string | null {
  if (!fields.serverUrl.trim() || !fields.email.trim() || !fields.password.trim()) {
    return "请填写站点地址、管理员邮箱和密码。";
  }

  return null;
}

export function validateTotp(code: string): string | null {
  if (!/^\d{6}$/.test(code.trim())) {
    return "请输入 6 位动态验证码。";
  }

  return null;
}
