/**
 * Minimal in-memory Supabase stand-in for API-route tests.
 *
 * Mirrors just enough of the postgrest-js surface (from/select/eq/in/
 * neq/order/limit/range/update/maybeSingle/single/rpc) that route
 * handlers run unmodified against scripted table data. Each test
 * supplies a responder; the responder sees the accumulated operation.
 */

export interface MockFilter {
  col: string;
  op: "eq" | "neq" | "in" | "not" | "or" | "gte" | "lte" | "ilike";
  val: unknown;
}

export interface MockOp {
  table: string | null;
  rpc: string | null;
  rpcArgs: unknown;
  filters: MockFilter[];
  single: boolean;
  updateValues: unknown;
}

export interface DbError {
  message: string;
  code?: string;
}

export interface MockResult {
  rows: unknown[];
  error: DbError | null;
  count?: number;
}

export type MockResponder = (op: MockOp) => MockResult;

export interface MockQueryResult {
  data: unknown;
  error: unknown;
  count?: number;
}

export interface MockBuilder {
  select(cols?: string, opts?: unknown): MockBuilder;
  eq(col: string, val: unknown): MockBuilder;
  neq(col: string, val: unknown): MockBuilder;
  in(col: string, val: unknown): MockBuilder;
  not(col: string, operator: string, val: unknown): MockBuilder;
  or(raw: string): MockBuilder;
  gte(col: string, val: unknown): MockBuilder;
  lte(col: string, val: unknown): MockBuilder;
  order(col: string, opts?: unknown): MockBuilder;
  limit(n: number): MockBuilder;
  range(from: number, to: number): MockBuilder;
  update(values: unknown): MockBuilder;
  insert(values: unknown): MockBuilder;
  delete(): MockBuilder;
  ilike(col: string, pattern: unknown): MockBuilder;
  maybeSingle(): MockBuilder;
  single(): MockBuilder;
  then(
    resolve: (v: MockQueryResult) => void,
    reject?: (e: unknown) => void,
  ): Promise<void>;
}

interface BuilderState {
  filters: MockFilter[];
  single: boolean;
  updateValues: unknown;
}

function run(
  responder: MockResponder,
  table: string,
  state: BuilderState,
): Promise<MockQueryResult> {
  const result = responder({
    table,
    rpc: null,
    rpcArgs: undefined,
    filters: state.filters,
    single: state.single,
    updateValues: state.updateValues,
  });
  const data = state.single ? (result.rows[0] ?? null) : result.rows;
  return Promise.resolve({ data, error: result.error, count: result.count });
}

function builder(
  responder: MockResponder,
  table: string,
  state: BuilderState,
): MockBuilder {
  const next = (patch: Partial<BuilderState>): MockBuilder =>
    builder(responder, table, {
      filters: [...state.filters],
      single: state.single,
      updateValues: state.updateValues,
      ...patch,
    });
  const b: MockBuilder = {
    select: () => next({}),
    eq: (col, val) => next({ filters: [...state.filters, { col, op: "eq", val }] }),
    neq: (col, val) =>
      next({ filters: [...state.filters, { col, op: "neq", val }] }),
    in: (col, val) =>
      next({ filters: [...state.filters, { col, op: "in", val }] }),
    not: (col, operator, val) =>
      next({
        filters: [
          ...state.filters,
          { col, op: "not", val: { operator, value: val } },
        ],
      }),
    or: (raw) =>
      next({ filters: [...state.filters, { col: "", op: "or", val: raw }] }),
    gte: (col, val) =>
      next({ filters: [...state.filters, { col, op: "gte", val }] }),
    lte: (col, val) =>
      next({ filters: [...state.filters, { col, op: "lte", val }] }),
    order: () => next({}),
    limit: () => next({}),
    range: () => next({}),
    update: (values) => next({ updateValues: values }),
    insert: (values) => next({ updateValues: values }),
    delete: () => next({}),
    ilike: (col, pattern) =>
      next({ filters: [...state.filters, { col, op: "ilike", val: pattern }] }),
    maybeSingle: () => next({ single: true }),
    single: () => next({ single: true }),
    then: (resolve, reject) => run(responder, table, state).then(resolve, reject),
  };
  return b;
}

function fresh(): BuilderState {
  return { filters: [], single: false, updateValues: undefined };
}

export interface MockUser {
  id: string;
  email?: string;
}

export interface MockClient {
  from(table: string): MockBuilder;
  rpc(
    name: string,
    args: unknown,
  ): Promise<{ data: unknown; error: unknown }>;
  auth: {
    getUser(): Promise<{
      data: { user: MockUser | null };
      error: { message: string } | null;
    }>;
  };
}

export function createMockClient(
  responder: MockResponder,
  opts?: { authUser?: MockUser | null },
): MockClient {
  const hasAuth = opts && "authUser" in opts;
  return {
    from: (table: string) => builder(responder, table, fresh()),
    auth: {
      getUser: () =>
        Promise.resolve(
          hasAuth
            ? { data: { user: opts?.authUser ?? null }, error: null }
            : { data: { user: null }, error: { message: "no session" } },
        ),
    },
    rpc: (name: string, args: unknown) => {
      const r = responder({
        table: null,
        rpc: name,
        rpcArgs: args,
        filters: [],
        single: false,
        updateValues: undefined,
      });
      // Like postgrest-js: a single jsonb/scalar row arrives unwrapped.
      const data = r.rows.length === 1 ? r.rows[0] : r.rows;
      return Promise.resolve({ data, error: r.error });
    },
  };
}
