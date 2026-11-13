import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Lỗi không xác định khi hiển thị giao diện',
    };
  }

  handleResetAndReload = () => {
    try {
      localStorage.removeItem('bilibatch_queue_items');
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <h1 className="text-base font-semibold text-slate-900 dark:text-white">
              Ứng dụng gặp sự cố hiển thị
            </h1>
            <p className="text-sm text-rose-600 dark:text-rose-400 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={this.handleResetAndReload}
              className="w-full px-4 py-2 text-sm font-semibold text-white bg-[#FB7299] hover:bg-[#e55d85] rounded-lg transition-colors cursor-pointer"
            >
              Đặt lại hàng đợi & Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
