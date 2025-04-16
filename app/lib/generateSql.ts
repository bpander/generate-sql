
type SqlDialect = 'sqlserver' | 'postgres' | 'mysql'

type SqlField = ['field', number]

type SqlValue<T> = SqlField & T

type SqlWhereClause =
  | ['and' | 'or', SqlWhereClause, SqlWhereClause]
  | ['not', SqlWhereClause]
  | ['<' | '>', SqlValue<number>, SqlValue<number>]
  | ['=' | '!=', ...SqlValue<number | string | null>]
  | ['is-empty', SqlValue<number | string | null>]

interface SqlQuery {
  limit?: number,
  where?: SqlWhereClause,
}

interface SqlFormatter {
  column: (name: string) => string,
}

const formatters: Record<SqlDialect, SqlFormatter> = {
  sqlserver: {
    column: name => `"${name}"`,
  },
  postgres: {
    column: name => `"${name}"`,
  },
  mysql: {
    column: name => '`' + name + '`',
  },
}

type Result<T, E> = { success: true, data: T } | { success: false, error: E }

interface SqlTranspilerOptions {
  tableName?: string,
  macros?: unknown,
  otherFormatters?: Record<string, SqlFormatter>,
}

export const createSqlTranspiler = ({ tableName, macros, otherFormatters }: SqlTranspilerOptions) => {
  const generateSql = (
    dialect: SqlDialect,
    fields: Record<number, string>,
    query: SqlQuery,
  ): Result<string, string> => {
    const sqlParts = ['SELECT']
    const formatter = formatters[dialect] || otherFormatters?.[dialect]
    if (!formatter) {
      return { success: false, error: `No formatter found for dialect: ${dialect}` }
    }
    return { success: true, data: sqlParts.join(' ') }
  }
  return { generateSql }
}
