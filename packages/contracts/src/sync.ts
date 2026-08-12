export type Sync<T> = T extends PromiseLike<unknown> ? never : T;
