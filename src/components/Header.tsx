import { useAuth } from '../context/AuthContext'

interface HeaderProps {
  onReset?: () => void
}

export default function Header({ onReset }: HeaderProps) {
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <button
          onClick={onReset}
          className="flex items-center gap-2 text-lg font-semibold text-slate-900 hover:text-indigo-600 transition-colors"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-indigo-600"
          >
            <path d="M12 20h9" />
            <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
            <path d="M15 5l3 3" />
          </svg>
          ТЗ-Ассистент
        </button>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
            прототип
          </span>
          {user && (
            <>
              <span className="hidden text-sm text-slate-600 sm:inline">
                {user.login}
              </span>
              <button
                onClick={() => logout()}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:text-sm"
              >
                Выйти
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
