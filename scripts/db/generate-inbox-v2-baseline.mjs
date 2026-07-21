import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROLE_BOOTSTRAP_SQL = `do $inbox_v2_role_bootstrap$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_retention_owner'
  ) then
    create role hulee_inbox_v2_retention_owner
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_runtime'
  ) then
    create role hulee_inbox_v2_runtime
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_membership_owner'
  ) then
    create role hulee_inbox_v2_membership_owner
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_membership_repair'
  ) then
    create role hulee_inbox_v2_membership_repair
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;
  if pg_catalog.pg_has_role(
       'hulee_inbox_v2_runtime',
       'hulee_inbox_v2_retention_owner',
       'MEMBER'
     ) or pg_catalog.pg_has_role(
       'hulee_inbox_v2_runtime',
       'hulee_inbox_v2_membership_owner',
       'MEMBER'
     ) or pg_catalog.pg_has_role(
       'hulee_inbox_v2_membership_repair',
       'hulee_inbox_v2_membership_owner',
       'MEMBER'
     ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.owner_role_must_not_be_inherited';
  end if;
end;
$inbox_v2_role_bootstrap$;

alter role hulee_inbox_v2_retention_owner
  with nologin nosuperuser nocreatedb nocreaterole
       inherit noreplication nobypassrls;
alter role hulee_inbox_v2_runtime
  with nologin nosuperuser nocreatedb nocreaterole
       inherit noreplication nobypassrls;
alter role hulee_inbox_v2_membership_owner
  with nologin nosuperuser nocreatedb nocreaterole
       inherit noreplication nobypassrls;
alter role hulee_inbox_v2_membership_repair
  with nologin nosuperuser nocreatedb nocreaterole
       inherit noreplication nobypassrls;
`;

const options = parseArguments(process.argv.slice(2));
const databaseUrl = new URL(
  requiredText(process.env.DATABASE_URL, "DATABASE_URL")
);
const container = requiredText(options.dockerContainer, "--docker-container");
const outputPath = resolve(
  options.output ?? "packages/db/drizzle/0000_inbox_v2_baseline.sql"
);
const databaseName = databaseUrl.pathname.slice(1);
if (databaseName.length === 0)
  throw new Error("DATABASE_URL has no database name.");
const databaseUser = decodeURIComponent(databaseUrl.username);
if (databaseUser.length === 0)
  throw new Error("DATABASE_URL has no database user.");
const [databaseOwnerName, databaseOwnerIdentifier] = execFileSync(
  "docker",
  [
    "exec",
    container,
    "psql",
    "-U",
    databaseUser,
    "-d",
    databaseName,
    "--no-psqlrc",
    "--tuples-only",
    "--no-align",
    "--field-separator=\t",
    "--command",
    `select pg_get_userbyid(datdba), quote_ident(pg_get_userbyid(datdba))
       from pg_catalog.pg_database
      where datname = current_database()`
  ],
  { encoding: "utf8" }
)
  .trim()
  .split("\t")
  .map((value) => requiredText(value, "source database owner"));

const dump = execFileSync(
  "docker",
  [
    "exec",
    container,
    "pg_dump",
    "-U",
    databaseUser,
    "-d",
    databaseName,
    "--schema-only",
    "--schema=public",
    "--no-comments",
    "--no-security-labels"
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);
const sanitizedDump = sanitizeDump(dump, {
  databaseOwnerIdentifier,
  databaseOwnerName
});
await writeFile(
  outputPath,
  `${ROLE_BOOTSTRAP_SQL}\n--> statement-breakpoint\n\n${sanitizedDump}`,
  "utf8"
);
process.stdout.write(
  `Generated ${outputPath} from ${container}/${databaseName}.\n`
);

function sanitizeDump(value, { databaseOwnerIdentifier, databaseOwnerName }) {
  const normalized = value.replaceAll("\r\n", "\n");
  const withoutPsqlGuards = normalized
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("\\restrict ") && !line.startsWith("\\unrestrict ")
    )
    .filter(
      (line) =>
        !/^SET (?:statement_timeout|lock_timeout|idle_in_transaction_session_timeout|client_encoding|standard_conforming_strings|xmloption|client_min_messages|row_security|default_tablespace|default_table_access_method) = /u.test(
          line
        ) && !line.startsWith("SELECT pg_catalog.set_config('search_path',")
    )
    .join("\n");
  const withoutPublicSchemaCreation = withoutPsqlGuards.replace(
    /--\n-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner\n--\n\nCREATE SCHEMA public;\n\n\nALTER SCHEMA public OWNER TO pg_database_owner;\n\n/gu,
    ""
  );
  if (withoutPublicSchemaCreation.includes("CREATE SCHEMA public")) {
    throw new Error(
      "Failed to remove CREATE SCHEMA public from pg_dump output."
    );
  }
  if (/^\\(?:un)?restrict\b/mu.test(withoutPublicSchemaCreation)) {
    throw new Error("Failed to remove pg_dump psql guard commands.");
  }
  const databaseOwnerSuffix = ` OWNER TO ${databaseOwnerIdentifier};`;
  const ownerNeutralDump = withoutPublicSchemaCreation
    .split("\n")
    .filter(
      (line) =>
        !(line.startsWith("ALTER ") && line.endsWith(databaseOwnerSuffix))
    )
    .map((line) =>
      line.startsWith("-- Name:")
        ? line.replace(`Owner: ${databaseOwnerName}`, "Owner: <database-owner>")
        : line
    )
    .join("\n");
  if (
    ownerNeutralDump
      .split("\n")
      .some(
        (line) =>
          line.startsWith("ALTER ") && line.endsWith(databaseOwnerSuffix)
      )
  ) {
    throw new Error("Failed to remove source database-owner assignments.");
  }
  return `${ownerNeutralDump.trim()}\n\nRESET check_function_bodies;\n`;
}

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--docker-container") {
      parsed.dockerContainer = arguments_[index + 1];
      index += 1;
    } else if (argument === "--output") {
      parsed.output = arguments_[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown baseline generator argument: ${argument}`);
    }
  }
  return parsed;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}
