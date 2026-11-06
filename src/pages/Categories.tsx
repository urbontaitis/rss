import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createCategory, deleteCategory, listCategories, listCounters, markAllRead, updateCategory } from '../lib/db'
import { useAsync } from '../lib/hooks'
import { bumpRevision } from '../lib/store'
import type { Category } from '../lib/types'

function CategoryRow({ category, unread, feeds }: { category: Category; unread: number; feeds: number }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(category.title)
  const [hidden, setHidden] = useState(category.hide_globally)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    await updateCategory(category.id, { title: title.trim(), hide_globally: hidden })
    setEditing(false)
    bumpRevision()
  }

  const remove = async () => {
    if (!confirm(`Remove category "${category.title}"? Feeds are kept without a category.`)) return
    await deleteCategory(category.id)
    bumpRevision()
  }

  const readAll = async () => {
    await markAllRead({ categoryId: category.id })
    bumpRevision()
  }

  if (editing) {
    return (
      <article className="item">
        <form onSubmit={save} className="form inline">
          <input type="text" required value={title} onChange={(event) => setTitle(event.target.value)} />
          <label className="checkbox"><input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} /> Hide in global unread list</label>
          <button type="submit" className="button primary">Save</button>
          <button type="button" className="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      </article>
    )
  }

  return (
    <article className="item">
      <div className="item-header">
        <span className="item-title">
          <Link to={`/category/${category.id}`}>{category.title}</Link>
          <span className="count"> ({unread})</span>
        </span>
      </div>
      <div className="item-meta">
        <ul className="item-meta-info">
          <li>{feeds} feed(s)</li>
          {category.hide_globally ? <li>Hidden from unread</li> : null}
        </ul>
        <ul className="item-meta-icons">
          <li><Link to={`/category/${category.id}?all=1`}>Entries</Link></li>
          {unread ? <li><button type="button" className="link-button" onClick={() => void readAll()}>Mark all as read</button></li> : null}
          <li><button type="button" className="link-button" onClick={() => setEditing(true)}>Edit</button></li>
          <li><button type="button" className="link-button danger" onClick={() => void remove()}>Remove</button></li>
        </ul>
      </div>
    </article>
  )
}

export function CategoriesPage() {
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const { data } = useAsync(async () => {
    const [categories, counters] = await Promise.all([listCategories(), listCounters()])
    return { categories, counters }
  })

  const add = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      await createCategory(title.trim())
      setTitle('')
      bumpRevision()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section>
      <div className="page-header"><h1>Categories{data ? <span className="count"> ({data.categories.length})</span> : null}</h1></div>
      <form onSubmit={add} className="form inline">
        <input type="text" required placeholder="New category" value={title} onChange={(event) => setTitle(event.target.value)} />
        <button type="submit" className="button primary">Add</button>
      </form>
      {error ? <p className="alert error">{error}</p> : null}
      <div className="items">
        {data?.categories.map((category) => {
          const related = data.counters.filter((counter) => counter.category_id === category.id)
          return <CategoryRow key={category.id} category={category} feeds={related.length} unread={related.reduce((sum, counter) => sum + Number(counter.unread), 0)} />
        })}
      </div>
    </section>
  )
}
