import { useEffect } from 'react'
import { createSqlTranspiler } from '~/lib/generateSql'

const fields = {
  1: 'id',
  2: 'name',
  3: 'date_joined',
  4: 'age',
}

export function Welcome() {
  useEffect(() => {
    const { generateSql } = createSqlTranspiler({ tableName: 'data' })
    const sql = generateSql('postgres', fields, {})
    console.log('sql:', sql)
  }, [])
  return (
    <main className='max-w-screen-md mx-auto px-4'>
      Hello
    </main>
  )
}
