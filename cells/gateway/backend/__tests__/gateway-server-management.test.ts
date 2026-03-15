import { describe, expect, it } from "bun:test";
import { createMemoryServerRegistry } from "../services/server-registry.ts";
import { createMemoryServerOAuthStateStore } from "../services/server-oauth-state.ts";

describe("gateway server management", () => {
  it("list returns per-user servers only", async () => {
    const registry = createMemoryServerRegistry();
    await registry.add("user-a", {
      id: "artist",
      name: "Artist",
      url: "https://artist.example.com",
    });
    await registry.add("user-b", {
      id: "drive",
      name: "Drive",
      url: "https://drive.example.com",
    });

    const a = await registry.list("user-a");
    const b = await registry.list("user-b");

    expect(a.map((item) => item.id)).toEqual(["artist"]);
    expect(b.map((item) => item.id)).toEqual(["drive"]);
  });

  it("search matches id/name/url for same user", async () => {
    const registry = createMemoryServerRegistry();
    await registry.add("u", {
      id: "artist",
      name: "Artist Tooling",
      url: "https://artist.example.com",
    });
    await registry.add("u", {
      id: "drive",
      name: "Drive Storage",
      url: "https://drive.example.com",
    });

    const byName = await registry.search("u", "tool");
    expect(byName.map((item) => item.id)).toEqual(["artist"]);

    const byUrl = await registry.search("u", "drive.example");
    expect(byUrl.map((item) => item.id)).toEqual(["drive"]);
  });

  it("oauth state is tracked per user and server", async () => {
    const oauthState = createMemoryServerOAuthStateStore();
    await oauthState.set("user-a", {
      serverId: "artist",
      accessToken: "token-a",
      refreshToken: "refresh-a",
    });
    await oauthState.set("user-b", {
      serverId: "artist",
      accessToken: "token-b",
    });

    const userA = await oauthState.get("user-a", "artist");
    const userB = await oauthState.get("user-b", "artist");
    expect(userA?.accessToken).toBe("token-a");
    expect(userB?.accessToken).toBe("token-b");
  });
});
