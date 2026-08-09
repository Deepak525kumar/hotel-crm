"use client";

import useSWR from "swr";
import { documentTemplatesApi } from "@/lib/api";
import type { ListInstancesQuery } from "@/lib/types";

/**
 * Lists document templates. Unlike `useHotels`/`useHotelGroups`, the backend
 * returns a plain array with no pagination envelope at all (`listTemplates`,
 * controller.ts) — there is no `usePaginatedList` wrapping here because
 * there is no page to advance.
 */
export function useDocumentTemplates() {
  const swr = useSWR(["document-templates"], () => documentTemplatesApi.listTemplates());
  return { ...swr, templates: swr.data ?? [] };
}

/** Fetches a single template by id, including its sections/fields/signature blocks. */
export function useDocumentTemplate(id: string | null | undefined) {
  return useSWR(
    id ? ["document-template", id] : null,
    ([, templateId]) => documentTemplatesApi.getTemplate(templateId),
  );
}

/**
 * Lists document instances. `query` is forwarded as-is (worker_id/status/
 * page/per_page) — self-scope (worker) vs. group-scope (manager/RM/admin) is
 * resolved entirely server-side per `requireInstanceReadAccess`, not by this
 * hook choosing a different endpoint.
 */
export function useDocumentInstances(query: ListInstancesQuery = {}) {
  const swr = useSWR(["document-instances", query], ([, q]) =>
    documentTemplatesApi.listInstances(q),
  );
  return { ...swr, instances: swr.data ?? [] };
}

/** Fetches a single instance by id, including its field values and signatures. */
export function useDocumentInstance(id: string | null | undefined) {
  return useSWR(
    id ? ["document-instance", id] : null,
    ([, instanceId]) => documentTemplatesApi.getInstance(instanceId),
  );
}
