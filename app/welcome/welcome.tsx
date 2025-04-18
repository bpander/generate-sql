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
    const { generateSql } = createSqlTranspiler()
    const sql = generateSql('postgres', fields, {
      where: [
        'and', ['!=', ['field', 3], null],
        ['or',
          ['>', ['field', 4], 25],
          ['=', ['field', 2], 'Jerry'],
        ]],
      })
    console.log('sql:', sql)
  }, [])
  return (
    <main className='max-w-screen-md mx-auto px-4'>
      Hello
    </main>
  )
}
