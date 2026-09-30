sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageToast'
], function (Controller, JSONModel, MessageToast) {
  'use strict';

  const STATUS_STATE = {
    RUNNING: 'Warning',
    STARTED: 'Success',
    ERROR: 'Error',
    TIMEOUT: 'Warning',
    GENERATION_FAILED: 'Error',
    FAILED: 'Error'
  };

  const POLL_INTERVAL_MS = 2000;
  const SERVICE_URL = '/deploy';

  return Controller.extend('cpideployer.sample.controller.App', {

    onInit: function () {
      this._currentJobId = null;
      this._pollHandle = null;
      this._i18n = this.getView().getModel('i18n').getResourceBundle();
      this.getView().setModel(new JSONModel({ artifacts: [] }), 'errors');
      this.getView().setModel(new JSONModel({ list: [] }), 'attempts');
    },

    onDescriptionChange: function () {
      const hasText = this.byId('descriptionInput').getValue().trim().length > 0;
      this.byId('deployButton').setEnabled(hasText);
    },

    onGenerateAndDeployPress: async function () {
      const id = this.byId('artifactIdInput').getValue().trim();
      const name = this.byId('artifactNameInput').getValue().trim();
      const packageId = this.byId('packageIdInput').getValue().trim();
      const description = this.byId('descriptionInput').getValue().trim();

      if (!id || !name || !packageId || !description) {
        MessageToast.show(this._i18n.getText('validationError'));
        return;
      }

      this._resetAttempts();
      this._setStatus('RUNNING', this._i18n.getText('statusRunning'));
      this._hideError();
      this._hideMaxAttempts();
      this.byId('deployButton').setEnabled(false);
      this.byId('fixButton').setVisible(false);

      try {
        const response = await fetch(`${SERVICE_URL}/generateAndDeploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, packageId, description })
        });

        const body = await response.json();

        if (!response.ok) {
          throw new Error((body.error && body.error.message) || `Request failed with status ${response.status}`);
        }

        this._currentJobId = body.jobId;
        this._pollJob(body.jobId);
      } catch (err) {
        this._setStatus('FAILED', this._i18n.getText('statusStartFailed'));
        this._showError(err.message);
        this.byId('deployButton').setEnabled(true);
      }
    },

    onFixAndRedeployPress: async function () {
      if (!this._currentJobId) return;

      this._setStatus('RUNNING', this._i18n.getText('statusFixing'));
      this._hideError();
      this.byId('fixButton').setEnabled(false);

      try {
        const response = await fetch(`${SERVICE_URL}/fixAndRedeploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: this._currentJobId })
        });

        const body = await response.json();

        if (!response.ok) {
          throw new Error((body.error && body.error.message) || `Request failed with status ${response.status}`);
        }

        this._pollJob(this._currentJobId);
      } catch (err) {
        this._setStatus('FAILED', this._i18n.getText('statusFixFailed'));
        this._showError(err.message);
        this.byId('fixButton').setEnabled(true);
      }
    },

    _pollJob: function (jobId) {
      clearTimeout(this._pollHandle);

      const poll = async () => {
        try {
          const response = await fetch(`${SERVICE_URL}/jobStatus(jobId='${encodeURIComponent(jobId)}')`);
          const job = await response.json();

          if (!response.ok) {
            throw new Error((job.error && job.error.message) || 'Could not fetch job status.');
          }

          this._updateAttempts(job.attemptsJson);

          if (job.status === 'RUNNING') {
            this._setStatus('RUNNING', this._i18n.getText('statusRunning'));
            this._pollHandle = setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }

          this.byId('deployButton').setEnabled(true);
          this.byId('fixButton').setEnabled(true);
          this.byId('fixButton').setVisible(job.canRetry);

          if (!job.canRetry && job.status !== 'STARTED') {
            this._showMaxAttempts();
          }

          if (job.status === 'STARTED') {
            this._setStatus('STARTED', this._i18n.getText('statusStarted', [job.artifactId]));
          } else if (job.status === 'ERROR') {
            this._setStatus('ERROR', this._i18n.getText('statusError', [job.artifactId]));
          } else if (job.status === 'TIMEOUT') {
            this._setStatus('TIMEOUT', this._i18n.getText('statusTimeout'));
          } else if (job.status === 'GENERATION_FAILED') {
            this._setStatus('GENERATION_FAILED', this._i18n.getText('statusGenerationFailed'));
          } else {
            this._setStatus('FAILED', this._i18n.getText('statusFailed'));
            if (job.error) this._showError(job.error);
          }
        } catch (err) {
          this.byId('deployButton').setEnabled(true);
          this._setStatus('FAILED', this._i18n.getText('statusFailed'));
          this._showError(err.message);
        }
      };

      poll();
    },

    _resetAttempts: function () {
      this.getView().getModel('attempts').setProperty('/list', []);
    },

    _updateAttempts: function (attemptsJson) {
      let attempts = [];
      try {
        attempts = JSON.parse(attemptsJson) || [];
      } catch (e) {
        attempts = [];
      }

      const decorated = attempts.map((attempt) => ({
        ...attempt,
        statusState: STATUS_STATE[attempt.status] || 'None'
      }));

      this.getView().getModel('attempts').setProperty('/list', decorated);
    },

    _setStatus: function (statusKey, text) {
      const statusText = this.byId('statusText');
      const statusBusy = this.byId('statusBusy');

      statusText.setText(text);
      statusText.setState(STATUS_STATE[statusKey] || 'None');
      statusBusy.setVisible(statusKey === 'RUNNING');
    },

    _showError: function (message) {
      const strip = this.byId('errorStrip');
      strip.setText(message);
      strip.setVisible(true);
    },

    _hideError: function () {
      this.byId('errorStrip').setVisible(false);
    },

    _showMaxAttempts: function () {
      this.byId('maxAttemptsStrip').setVisible(true);
    },

    _hideMaxAttempts: function () {
      this.byId('maxAttemptsStrip').setVisible(false);
    },

    onCheckErrorsPress: async function () {
      this._hideErrorDetail();

      try {
        const response = await fetch(`${SERVICE_URL}/listErrorArtifacts()`);
        const body = await response.json();

        if (!response.ok) {
          throw new Error((body.error && body.error.message) || 'Could not list error artifacts.');
        }

        const artifacts = body.value || [];
        this.getView().getModel('errors').setProperty('/artifacts', artifacts);

        if (!artifacts.length) {
          MessageToast.show(this._i18n.getText('noErrorArtifacts'));
        }
      } catch (err) {
        MessageToast.show(err.message);
      }
    },

    onViewErrorPress: async function (event) {
      const context = event.getSource().getBindingContext('errors');
      const id = context.getProperty('Id');

      this._hideErrorDetail();

      try {
        const response = await fetch(`${SERVICE_URL}/getArtifactError(id='${encodeURIComponent(id)}')`);
        const body = await response.json();

        if (!response.ok) {
          throw new Error((body.error && body.error.message) || `Could not fetch error detail for '${id}'.`);
        }

        this._showErrorDetail(
          body.detail === null
            ? this._i18n.getText('errorDetailEmpty', [id])
            : `${id}:\n${body.detail}`
        );
      } catch (err) {
        this._showErrorDetail(err.message);
      }
    },

    _showErrorDetail: function (text) {
      const strip = this.byId('errorDetailStrip');
      strip.setText(text);
      strip.setVisible(true);
    },

    _hideErrorDetail: function () {
      this.byId('errorDetailStrip').setVisible(false);
    }

  });
});
