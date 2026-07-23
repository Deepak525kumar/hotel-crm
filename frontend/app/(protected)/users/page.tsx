"use client";

import { useState } from "react";
import Link from "next/link";
import { useUsers } from "@/hooks/useUsers";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { RoleGate } from "@/components/auth/RoleGate";
import { RoleBadge } from "@/components/users/RoleBadge";
import {
  ActiveBadge,
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
import type { Role } from "@/lib/types";

const ROLE_FILTERS = [
  { value: "", label: "All roles" },
  { value: "worker", label: "Worker" },
  { value: "checker", label: "Checker" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

const ACTIVE_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

const PER_PAGE = 20;

function UsersDirectory() {
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
        title="Users"
        description="People with access to the platform."
        actions={
          <Link href="/users/new">
            <Button>New user</Button>
          </Link>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-xs">
          <Input
            label="Search"
            type="search"
            placeholder="Name or email…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-40">
          <Select
            label="Role"
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
            options={ROLE_FILTERS}
          />
        </div>
        <div className="w-full sm:w-40">
          <Select
            label="Status"
            value={active}
            onChange={(e) => onActiveChange(e.target.value)}
            options={ACTIVE_FILTERS}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load users. Please try again.
            </div>
          ) : (
            <Table aria-label="Users">
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={columns} />
              ) : users.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={columns} className="p-0">
                      <EmptyState
                        title="No users found"
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
                      <TD className="text-gray-500">{u.email}</TD>
                      <TD>
                        <RoleBadge role={u.role} />
                      </TD>
                      <TD>
                        <ActiveBadge active={u.is_active} />
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
  return (
    <RoleGate
      allow={["admin"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500">
            Only admins can manage users.
          </CardContent>
        </Card>
      }
    >
      <UsersDirectory />
    </RoleGate>
  );
}
