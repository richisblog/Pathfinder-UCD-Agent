export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Result = { [key: string]: Json }
export type Args = Record<string, unknown>
