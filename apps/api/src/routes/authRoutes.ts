import type { FastifyInstance } from "fastify";
import type {
  AuthMeResponse,
  BootstrapStatusResponse
} from "@collection-tool/shared";
import {
  authenticateLogin,
  clearSessionCookie,
  countUsers,
  createBootstrapUser,
  createSession,
  deleteSession,
  getAuthContext,
  listCollectionsForUser,
  pruneExpiredSessions,
  setSessionCookie,
  validateEmail
} from "../auth.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";

type AuthBody = {
  email?: string;
  password?: string;
  displayName?: string;
};

export async function registerAuthRoutes(
  app: FastifyInstance,
  config: AppConfig,
  database: AppDatabase
) {
  app.get("/api/auth/bootstrap-status", async (): Promise<BootstrapStatusResponse> => ({
    needsBootstrap: countUsers(database) === 0
  }));

  app.get("/api/auth/me", async (request): Promise<AuthMeResponse> => {
    pruneExpiredSessions(database);
    const auth = getAuthContext(request, database);

    if (!auth) {
      return {
        user: null,
        collections: []
      };
    }

    return {
      user: auth.user,
      collections: listCollectionsForUser(database, auth.user.id)
    };
  });

  app.post("/api/auth/bootstrap", async (request, reply): Promise<AuthMeResponse> => {
    const body = request.body as AuthBody;
    const email = body.email ?? "";
    const password = body.password ?? "";
    const displayName = body.displayName ?? "";

    if (!validateEmail(email)) {
      reply.code(400);
      throw new Error("Enter a valid email address.");
    }

    if (displayName.trim().length < 2) {
      reply.code(400);
      throw new Error("Enter a display name.");
    }

    if (password.length < 12) {
      reply.code(400);
      throw new Error("Password must be at least 12 characters.");
    }

    const user = createBootstrapUser(database, {
      email,
      password,
      displayName
    });

    if (!user) {
      reply.code(500);
      throw new Error("Unable to create bootstrap user.");
    }

    const session = createSession(database, user.id);
    setSessionCookie(reply, config, session.token);

    return {
      user,
      collections: listCollectionsForUser(database, user.id)
    };
  });

  app.post("/api/auth/login", async (request, reply): Promise<AuthMeResponse> => {
    const body = request.body as AuthBody;
    const user = authenticateLogin(database, {
      email: body.email ?? "",
      password: body.password ?? ""
    });

    if (!user) {
      reply.code(401);
      throw new Error("Invalid email or password.");
    }

    const session = createSession(database, user.id);
    setSessionCookie(reply, config, session.token);

    return {
      user,
      collections: listCollectionsForUser(database, user.id)
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (auth) {
      deleteSession(database, auth.sessionId);
    }

    clearSessionCookie(reply, config);
    return { ok: true };
  });
}

