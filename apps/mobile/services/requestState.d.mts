export type RequestState = 'IDLE' | 'LOADING' | 'SUCCESS' | 'EMPTY' | 'ERROR' | 'UNAVAILABLE' | 'UNAUTHORIZED';
export declare class ApiError extends Error {
    state: RequestState;
    status: number | null;
    requestId: string;
    constructor(state: RequestState, requestId: string, status?: number | null);
}
export declare const stateForStatus: (status: number) => RequestState;
export interface RequestDiagnostic {
    requestId: string;
    status: number | null;
    attempt: number;
}
export declare const getRequestDiagnostics: () => {
    requestId: string;
    status: number | null;
    attempt: number;
}[];
export declare function createTransport(transport: typeof fetch, options?: {
    timeoutMs?: number;
    delay?: (ms: number) => Promise<void>;
    diagnostic?: (event: {
        requestId: string;
        status: number | null;
        attempt: number;
    }) => void;
}): (url: string, init?: RequestInit) => Promise<Response>;
export declare function parseResponse(response: Response, validate: (value: any) => boolean): Promise<any>;
export declare const isObject: (value: any) => boolean;
export declare const validWallet: (value: any) => boolean;
export interface CachedValue<T> {
    account: object;
    data: T;
    at: number;
}
export declare function visibleCache<T>(cache: CachedValue<T> | null, account: object | null, now?: number): T | null;
