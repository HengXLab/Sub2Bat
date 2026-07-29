import { describe, expect, it } from "vitest";
import { validateLogin, validateTotp } from "./login";

describe("login validation", () => {
  it("requires a server address, administrator email, and password", () => {
    expect(validateLogin({ serverUrl: "", email: "", password: "" })).toBe("请填写站点地址、管理员邮箱和密码。");
    expect(validateLogin({ serverUrl: "https://api.example.test", email: "admin@example.test", password: "secret" })).toBeNull();
  });

  it("accepts only six digit TOTP codes", () => {
    expect(validateTotp("12ab56")).toBe("请输入 6 位动态验证码。");
    expect(validateTotp("123456")).toBeNull();
  });
});
