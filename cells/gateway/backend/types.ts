export type UserAuth = {
  type: "user";
  userId: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type DelegateAuth = {
  type: "delegate";
  realmId: string;
  delegateId: string;
  permissions: string[];
};

export type Env = {
  Variables: {
    auth?: UserAuth | DelegateAuth;
  };
};
