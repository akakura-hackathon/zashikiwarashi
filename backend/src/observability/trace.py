"""OpenTelemetry and Cloud Trace observability module (FN-11, docs/ARCHITECTURE.md §3.5).

制御ポイント:
- O1: Cloud Trace（ADK / OpenTelemetry スパン、plan_id による Agent 横断追跡）
- PRV-03: プロンプト・メッセージ本文の非記録
  （OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=NO_CONTENT）
"""

import os
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

# PRV-03: プロンプトと応答の本文は記録しない（メタデータ・スパン属性のみ記録）
os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "NO_CONTENT"

TRACER_NAME = "zashikiwarashi.agent"
tracer = trace.get_tracer(TRACER_NAME)


def init_tracer(project_id: str | None = None) -> None:
    """Initialize OpenTelemetry tracer provider with Cloud Trace exporter if in GCP environment."""
    os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "NO_CONTENT"

    # もし GCP Cloud Trace エクスポーターが存在し、プロジェクトIDが指定されている場合はセットアップ
    if project_id or os.getenv("GOOGLE_CLOUD_PROJECT"):
        try:
            from opentelemetry.exporter.gcp_trace import CloudTraceSpanExporter
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor

            provider = TracerProvider()
            processor = BatchSpanProcessor(CloudTraceSpanExporter(project_id=project_id))
            provider.add_span_processor(processor)
            trace.set_tracer_provider(provider)
        except Exception:
            # エクスポーター未インストール時やローカル実行時は既定のトレーサーをそのまま使用
            pass


@contextmanager
def trace_span(
    name: str,
    plan_id: str | None = None,
    attributes: dict[str, Any] | None = None,
) -> Generator[trace.Span, None, None]:
    """Execute block within an OpenTelemetry span with plan_id and metadata attributes.

    Args:
        name: スパン名（例: "BuildingAgent.execute_triage"）
        plan_id: Agent をまたいで追跡するためのキー（Issue ID / Task ID / Emergency ID）
        attributes: 追加属性（生テキストは含めないこと）
    """
    with tracer.start_as_current_span(name) as span:
        if plan_id:
            span.set_attribute("zashikiwarashi.plan_id", plan_id)

        if attributes:
            for k, v in attributes.items():
                if v is not None:
                    # 生テキスト本文の除外（PRV-03）
                    if k in ("raw_message", "message", "prompt", "response_text"):
                        continue
                    if isinstance(v, (str, int, float, bool)):
                        span.set_attribute(f"zashikiwarashi.{k}", v)
                    else:
                        span.set_attribute(f"zashikiwarashi.{k}", str(v))

        try:
            yield span
            span.set_status(Status(StatusCode.OK))
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, str(exc)))
            raise


def get_current_trace_context() -> dict[str, str]:
    """Return current trace_id and span_id for correlation."""
    current_span = trace.get_current_span()
    span_ctx = current_span.get_span_context()
    if span_ctx.is_valid:
        return {
            "trace_id": format(span_ctx.trace_id, "032x"),
            "span_id": format(span_ctx.span_id, "016x"),
        }
    return {}
