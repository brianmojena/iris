import { useState } from "react";
import { useEditor } from "../state/editorStore";
import { fill, useDict } from "../i18n";
import {
  CURVE_CHANNELS,
  isNeutralCurve,
  isNeutralGrade,
  neutralCurve,
  WHEEL_KEYS,
  type CurveChannel,
} from "../types/grade";
import { ColorWheel } from "./ColorWheel";
import { CurveEditor } from "./CurveEditor";
import { SecondaryPanel } from "./SecondaryPanel";
import { IconDownload, IconReset } from "./icons";

/**
 * The grading tab: four wheels and four curves.
 *
 * Kept apart from the adjustment sliders rather than appended to them, because
 * the two are answers to different questions. The sliders are "make this photo
 * right"; the wheels and curves are "put this photo somewhere", and mixing them
 * into one scrolling list would bury the first under the second.
 */
export function GradePanel({ onExport }: { onExport: () => void }) {
  const image = useEditor((s) => s.image);
  const grade = useEditor((s) => s.edit.grade);
  const startEdit = useEditor((s) => s.startEdit);
  const endEdit = useEditor((s) => s.endEdit);
  const setWheel = useEditor((s) => s.setWheel);
  const setCurve = useEditor((s) => s.setCurve);
  const resetGrade = useEditor((s) => s.resetGrade);
  const tab = useEditor((s) => s.gradeTab);
  const setTab = useEditor((s) => s.setGradeTab);
  const [channel, setChannel] = useState<CurveChannel>("rgb");
  const t = useDict();

  if (!image) {
    return (
      <aside className="panel">
        <p className="panel__empty">{t.panel.emptyColor}</p>
      </aside>
    );
  }

  const curve = grade.curves[channel];
  const curveTouched = !isNeutralCurve(curve);

  return (
    <aside className="panel">
      <div className="panel__scroll">
        {/* The primary reaches every pixel; a secondary reaches only what its
            matte covers. Two different questions, so two different screens. */}
        <div className="segmented segmented--tabs">
          <button
            aria-pressed={tab === "primary"}
            onClick={() => setTab("primary")}
          >
            {t.secondary.tabs.primary}
          </button>
          <button
            aria-pressed={tab === "selective"}
            onClick={() => setTab("selective")}
          >
            {t.secondary.tabs.selective}
          </button>
        </div>

        {tab === "selective" ? (
          <SecondaryPanel />
        ) : (
          <>
            <section className="group">
              <h2 className="group__title">{t.grade.wheelsTitle}</h2>
              <div className="wheels">
                {WHEEL_KEYS.map((key) => (
                  <ColorWheel
                    key={key}
                    label={t.grade.wheels[key]}
                    hint={t.grade.wheelHints[key]}
                    balanceLabel={fill(t.grade.balance, {
                      name: t.grade.wheels[key],
                    })}
                    masterLabel={`${t.grade.wheels[key]} · ${t.grade.master}`}
                    resetLabel={fill(t.grade.resetWheel, {
                      name: t.grade.wheels[key],
                    })}
                    value={grade.wheels[key]}
                    onStart={startEdit}
                    onChange={(patch) => setWheel(key, patch)}
                    onEnd={endEdit}
                  />
                ))}
              </div>
            </section>

            <section className="group">
              <div className="group__head">
                <h2 className="group__title">{t.grade.curvesTitle}</h2>
                <button
                  className="group__action"
                  onClick={() => {
                    startEdit();
                    setCurve(channel, neutralCurve());
                    endEdit();
                  }}
                  disabled={!curveTouched}
                  aria-label={fill(t.grade.resetCurve, {
                    name: t.grade.channels[channel],
                  })}
                >
                  <IconReset size={14} />
                </button>
              </div>

              <div className="segmented segmented--curve">
                {CURVE_CHANNELS.map((option) => (
                  <button
                    key={option}
                    aria-pressed={channel === option}
                    onClick={() => setChannel(option)}
                    className={
                      isNeutralCurve(grade.curves[option])
                        ? undefined
                        : "segmented__marked"
                    }
                  >
                    {t.grade.channels[option]}
                  </button>
                ))}
              </div>

              <CurveEditor
                channel={channel}
                curve={curve}
                labels={t.grade.channels}
                onStart={startEdit}
                onChange={(next) => setCurve(channel, next)}
                onEnd={endEdit}
              />
              <p className="curve__hint">{t.grade.curveHint}</p>
            </section>
          </>
        )}
      </div>

      <div className="panel__footer">
        <button
          className="btn"
          onClick={resetGrade}
          disabled={isNeutralGrade(grade)}
        >
          <IconReset /> {t.panel.reset}
        </button>
        <button className="btn btn--primary" onClick={onExport}>
          <IconDownload /> {t.app.export}
        </button>
      </div>
    </aside>
  );
}
