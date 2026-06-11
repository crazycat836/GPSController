/** System / host utility endpoints (`/api/system/*`). */
import { request } from './http'

export const openLogFolder = () => request<{ status: string; path: string }>('POST', '/api/system/open-log-folder')
