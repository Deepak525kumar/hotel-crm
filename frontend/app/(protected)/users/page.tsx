"use client";

import { useState } from "react";
import Link from "next/link";
import { useUsers } from "@/hooks/useUsers";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { RoleGate } from "@/components/auth/RoleGate";
import { RoleBadge } from "@/components/users/RoleBadge";
import {
  ActiveBadge,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Pager,
  PageHeader,
  Select,
  Table,
  TBody,
  TableSkeleton,
  TD,
  TH,
  THead,
  TR,
  TextLink,
} from "@/components/ui";
import { EMPLOYMENT_STATUS_TONE, EMPLOYMENT_STATUS_LABEL } from "@/lib/employmentStatus";
import type { Role } from "@/lib/types";
import { useTranslation } from "react-i18next";

const ROLE_FILTERS = [
  { value: "", label: "All roles" },
  { value: "worker", label: "Worker" },
  { value: "checker", label: "Checker" },
  { value: "manager", label: "Manager" },
  { value: "regional_manager", label: "Regional Manager" },
  { value: "admin", label: "Admin" },
];

const ACTIVE_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

const PER_PAGE = 20;

function UsersDirectory() {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState("");
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(searchInput.trim(), 300);

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    setPage(1);
  };
  const onRoleChange = (value: string) => {
    setRole(value);
    setPage(1);
  };
  const onActiveChange = (value: string) => {
    setActive(value);
    setPage(1);
  };

  const { users, isLoading, error, hasNext } = useUsers({
    search: search || undefined,
    role: (role || undefined) as Role | undefined,
    is_active: (active || undefined) as "true" | "false" | undefined,
    page,
    limit: PER_PAGE,
  });

  const columns = 4;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.users")}
        description={t("users.pageDescription")}
        actions={
          // RULE A (project-owner decision, 2026-08-12): create is
          // 1-level-down, so manager/RM may create too — each limited to its
          // own one-level-down role (UserForm's selector; enforced
          // authoritatively in users/service.ts). worker/checker may create
          // nobody and so get no button.
          <RoleGate allow={["admin", "regional_manager", "manager"]}>
            <Link href="/users/new">
              <Button>{t("users.new")}</Button>
            </Link>
          </RoleGate>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-xs">
          <Input
            label={t("common.search")}
            type="search"
            placeholder={t("search.nameOrEmailShort")}
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-40">
          <Select
            label={t("fields.role")}
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
            options={ROLE_FILTERS}
          />
        </div>
        <div className="w-full sm:w-40">
          <Select
            label={t("fields.status")}
            value={active}
            onChange={(e) => onActiveChange(e.target.value)}
            options={ACTIVE_FILTERS}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600 dark:text-red-400">
              {t("users.loadFailed")}
            </div>
          ) : (
            <Table aria-label={t("nav.users")}>
              <THead>
                <tr>
                  <TH>{t("fields.name")}</TH>
                  <TH>{t("fields.email")}</TH>
                  <TH>{t("fields.role")}</TH>
                  <TH>{t("fields.status")}</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={columns} />
              ) : users.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={columns} className="p-0">
                      <EmptyState
                        title={t("users.noneFound")}
                        description={
                          search || role || active
                            ? "Try adjusting your search or filters."
                            : "Invite your first teammate to get started."
                        }
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {users.map((u) => (
                    <TR key={u.id}>
                      <TD className="font-medium">
                        <TextLink
                          href={`/users/${u.id}`}
                          className="block"
                        >
                          {u.first_name} {u.last_name}
                        </TextLink>
                      </TD>
                      <TD className="text-gray-500 dark:text-gray-400">{u.email}</TD>
                      <TD>
                        <RoleBadge role={u.role} />
                      </TD>
                      <TD>
                        {/* Employment status when the person has one — that
                            is what "active" means to a reviewer. `is_active`
                            is the account/sign-in flag and is true from
                            creation, so showing it alone made a brand-new,
                            un-onboarded user read as Active. Falls back to
                            the account flag only for accounts with no
                            employment record (admins, pre-ADR-065 users). */}
                        {u.employment_status ? (
                          <Badge tone={EMPLOYMENT_STATUS_TONE[u.employment_status]}>
                            {EMPLOYMENT_STATUS_LABEL[u.employment_status]}
                          </Badge>
                        ) : (
                          <ActiveBadge active={u.is_active} />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      <Pager
        page={page}
        hasNext={hasNext}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}

export default function UsersPage() {
  const { t } = useTranslation();
  return (
    <RoleGate
      allow={["admin", "manager", "regional_manager"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500 dark:text-gray-400">
            {t("users.listNoPermission")}
          </CardContent>
        </Card>
      }
    >
      <UsersDirectory />
    </RoleGate>
  );
}
