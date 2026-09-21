import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { DEFAULT_BUSINESS, DEFAULT_RECEIPT } from '../lib/settings'
import type { Branch, Category, Discount, Product, Settings } from '../lib/types'

export function useBranches(includeInactive = false) {
  return useQuery({
    queryKey: ['branches', includeInactive],
    queryFn: async () => (await api.get<Branch[]>('/branches', { params: { include_inactive: includeInactive } })).data,
  })
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<Category[]>('/categories')).data,
    staleTime: 60_000,
  })
}

/** Cashiers only receive the discounts that are active today; managers and admins receive all of them. */
export function useDiscounts() {
  return useQuery({
    queryKey: ['discounts'],
    queryFn: async () => (await api.get<Discount[]>('/discounts')).data,
  })
}

/** Shop profile, currency and receipt layout. Falls back to the built-in defaults while loading. */
export function useSettings() {
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Settings>('/settings')).data,
    staleTime: 5 * 60_000,
  })
  return {
    ...q,
    business: q.data?.business ?? DEFAULT_BUSINESS,
    receipt: q.data?.receipt ?? DEFAULT_RECEIPT,
    timezone: q.data?.timezone ?? '',
  }
}

/** Every active product (for pickers). */
export function useAllProducts() {
  return useQuery({
    queryKey: ['products', 'all-active'],
    queryFn: async () => (await api.get<Product[]>('/products', { params: { limit: 1000 } })).data,
  })
}
