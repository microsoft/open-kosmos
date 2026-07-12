import React from 'react'
import { Search, X } from 'lucide-react'
import '../../styles/ListSearchBox.css'
import { useI18n } from '../../lib/i18n/useI18n'

interface ListSearchBoxProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

const ListSearchBox: React.FC<ListSearchBoxProps> = ({
  value,
  onChange,
  placeholder,
}) => {
  const { t } = useI18n()
  const resolvedPlaceholder = placeholder ?? t('common.searchPlaceholder')
  return (
    <div className="list-search-box">
      <Search size={14} className="list-search-icon" />
      <input
        type="text"
        className="list-search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={resolvedPlaceholder}
      />
      {value && (
        <button
          className="list-search-clear"
          onClick={() => onChange('')}
          title={t('common.clearSearch')}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export default ListSearchBox
