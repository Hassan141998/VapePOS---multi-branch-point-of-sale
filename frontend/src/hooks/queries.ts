import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Branch } from '../lib/types'

export function useBranches(includeInactive = false) {
  return useQuery({
    queryKey: ['branches', includeInactive],
    queryFn: async () => (await api.get<Branch[]>('/branches', { params: { include_inactive: includeInactive } })).data,
  })
}
