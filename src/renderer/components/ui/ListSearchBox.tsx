import React from 'react'
import { Search, X } from 'lucide-react'
import '../../styles/ListSearchBox.css'

interface ListSearchBoxProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

const ListSearchBox: React.FC<ListSearchBoxProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
}) => {
  return (
    <div className="list-search-box">
      <Search size={14} className="list-search-icon" />
      <input
        type="text"
        className="list-search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          className="list-search-clear"
          onClick={() => onChange('')}
          title="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export default ListSearchBox
