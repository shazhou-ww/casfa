/** Delegate 的细粒度权限（可配置）；delegates 使用 use_mcp、manage_delegates */
export type DelegatePermission =
  | "file_read"
  | "file_write"
  | "branch_manage"
  | "delegate_manage"
  | "use_mcp"
  | "manage_delegates";

/** Worker 的访问模式 */
export type WorkerAccess = "readonly" | "readwrite";

/** User：Realm 拥有者；realmId 由 userId 查询（当前 1:1），天然全权限；Cognito 验签后可带 profile 字段 */
export type UserAuth = {
  type: "user";
  userId: string;
  email?: string;
  name?: string;
  picture?: string;
};

/** Delegate：长期授权客户端/Agent */
export type DelegateAuth = {
  type: "delegate";
  realmId: string;
  delegateId: string;
  clientId: string;
  permissions: DelegatePermission[];
};

/** Worker：持 Branch Token */
export type WorkerAuth = {
  type: "worker";
  realmId: string;
  branchId: string;
  access: WorkerAccess;
};

export type AuthContext = UserAuth | DelegateAuth | WorkerAuth;

/** Hono bindings */
export type Env = {
  Variables: {
    auth?: AuthContext;
  };
};

/** 统一错误响应体 */
export type ErrorBody = {
  error: string;
  message: string;
};

export function errorResponse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
