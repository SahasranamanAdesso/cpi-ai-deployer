sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageToast',
  'sap/m/MessageBox'
], function (Controller, JSONModel, MessageToast, MessageBox) {
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
      this._zipBase64 = null;
      this._i18n = this.getView().getModel('i18n').getResourceBundle();
      this.getView().setModel(new JSONModel({ artifacts: [] }), 'errors');
      this.getView().setModel(new JSONModel({ list: [] }), 'attempts');
      this.getView().setModel(new JSONModel({ list: [] }), 'jobs');
      this._loadJobs();
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
      this._setFixButtonsVisible(false);

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
      this._setFixButtonsEnabled(false);

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
        this._setFixButtonsEnabled(true);
      }
    },

    _setFixButtonsEnabled: function (enabled) {
      ['fixButton', 'zipFixButton'].forEach((id) => this.byId(id).setEnabled(enabled));
    },

    _setFixButtonsVisible: function (visible) {
      ['fixButton', 'zipFixButton'].forEach((id) => this.byId(id).setVisible(visible));
    },

    onZipFileChange: function (event) {
      const file = event.getParameter('files') && event.getParameter('files')[0];
      const deployZipButton = this.byId('deployZipButton');

      this._zipBase64 = null;
      deployZipButton.setEnabled(false);

      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        // reader.result is a data: URL - strip the "data:...;base64," prefix.
        this._zipBase64 = reader.result.split(',')[1];
        deployZipButton.setEnabled(true);
      };
      reader.onerror = () => {
        MessageToast.show(this._i18n.getText('fileReadError'));
      };
      reader.readAsDataURL(file);
    },

    onDeployZipPress: async function () {
      const id = this.byId('zipArtifactIdInput').getValue().trim();
      const name = this.byId('zipArtifactNameInput').getValue().trim();
      const packageId = this.byId('zipPackageIdInput').getValue().trim();
      const description = this.byId('zipDescriptionInput').getValue().trim();

      if (!id || !name || !packageId || !this._zipBase64) {
        MessageToast.show(this._i18n.getText('zipValidationError'));
        return;
      }

      this._resetAttempts();
      this._setStatus('RUNNING', this._i18n.getText('statusRunning'));
      this._hideError();
      this._hideMaxAttempts();
      this.byId('deployZipButton').setEnabled(false);
      this._setFixButtonsVisible(false);

      try {
        const response = await fetch(`${SERVICE_URL}/deployZip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, packageId, zipBase64: this._zipBase64, description })
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
        this.byId('deployZipButton').setEnabled(true);
      }
    },

    onFixBrokenFlowPress: function (event) {
      const context = event.getSource().getBindingContext('errors');
      const id = context.getProperty('Id');
      this._fixDialogArtifact = {
        id,
        name: context.getProperty('Name') || id
      };

      // Pull the most recent known packageId/description for this artifact
      // from job history (data/jobs.csv via listJobs), so the user doesn't
      // have to retype what the app already knows - defaults to cpipackage
      // and a blank description only when this artifact has no prior job.
      const priorJob = this.getView().getModel('jobs').getProperty('/list')
        .filter((job) => job.id === id)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];

      this.byId('fixDialogIntro').setText(this._i18n.getText('fixDialogIntro', [id]));
      this.byId('fixDialogPackageIdInput').setValue((priorJob && priorJob.packageId) || 'cpipackage');
      this.byId('fixDialogDescriptionInput').setValue((priorJob && priorJob.originalRequest) || '');
      this.byId('fixDialogErrorStrip').setVisible(false);
      this.byId('fixDialogStatusText').setText('');
      this.byId('fixDialogBusy').setVisible(false);
      this.byId('fixRedeployDialog').open();
    },

    onConfirmFixRedeploy: async function () {
      const { id, name } = this._fixDialogArtifact;
      const packageId = this.byId('fixDialogPackageIdInput').getValue().trim();
      const description = this.byId('fixDialogDescriptionInput').getValue().trim();

      if (!packageId || !description) {
        MessageToast.show(this._i18n.getText('fixDialogMissingDescription'));
        return;
      }

      this.byId('fixDialogBusy').setVisible(true);
      this.byId('fixDialogErrorStrip').setVisible(false);
      this.byId('fixDialogConfirmButton').setEnabled(false);
      this.byId('fixDialogStatusText').setText(this._i18n.getText('statusRunning'));

      try {
        const addResponse = await fetch(`${SERVICE_URL}/addManualJob`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, packageId, description })
        });
        const addBody = await addResponse.json();
        if (!addResponse.ok) {
          throw new Error((addBody.error && addBody.error.message) || `Request failed with status ${addResponse.status}`);
        }

        const fixResponse = await fetch(`${SERVICE_URL}/fixAndRedeploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: addBody.jobId })
        });
        const fixBody = await fixResponse.json();
        if (!fixResponse.ok) {
          throw new Error((fixBody.error && fixBody.error.message) || `Request failed with status ${fixResponse.status}`);
        }

        MessageToast.show(this._i18n.getText('fixDialogStarted'));
        this.byId('fixRedeployDialog').close();
        this._currentJobId = addBody.jobId;
        await this._loadJobs();
        this.byId('iconTabBar').setSelectedKey('history');
      } catch (err) {
        this.byId('fixDialogStatusText').setText('');
        const strip = this.byId('fixDialogErrorStrip');
        strip.setText(err.message);
        strip.setVisible(true);
      } finally {
        this.byId('fixDialogBusy').setVisible(false);
        this.byId('fixDialogConfirmButton').setEnabled(true);
      }
    },

    onCloseFixDialog: function () {
      this.byId('fixRedeployDialog').close();
    },

    onShowSummaryPress: function (event) {
      const context = event.getSource().getBindingContext('attempts');
      const attemptNumber = context.getProperty('attemptNumber');
      const summary = context.getProperty('summary');

      MessageBox.information(summary, {
        title: this._i18n.getText('summaryDialogTitle', [attemptNumber])
      });
    },

    _loadJobs: async function () {
      try {
        const response = await fetch(`${SERVICE_URL}/listJobs()`);
        const body = await response.json();

        if (!response.ok) {
          throw new Error((body.error && body.error.message) || 'Could not list jobs.');
        }

        this.getView().getModel('jobs').setProperty('/list', body.value || []);
      } catch (err) {
        MessageToast.show(err.message);
      }
    },

    onRefreshJobsPress: function () {
      this._loadJobs();
    },

    onSelectJobPress: function (event) {
      const context = event.getSource().getBindingContext('jobs');
      const jobId = context.getProperty('jobId');

      this._currentJobId = jobId;
      this._resetAttempts();
      this._hideError();
      this._hideMaxAttempts();
      this._setStatus('RUNNING', this._i18n.getText('statusRunning'));
      this.byId('iconTabBar').setSelectedKey('generate');
      this._pollJob(jobId);
    },

    onDownloadZipPress: function (event) {
      const context = event.getSource().getBindingContext('attempts');
      const attemptNumber = context.getProperty('attemptNumber');

      if (!this._currentJobId) return;

      const url = `${SERVICE_URL}/downloadZip(jobId='${encodeURIComponent(this._currentJobId)}',attemptNumber=${encodeURIComponent(attemptNumber)})`;
      window.open(url, '_blank');
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
          this.byId('deployZipButton').setEnabled(true);
          this._setFixButtonsEnabled(true);
          this._setFixButtonsVisible(job.canRetry);

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

          this._loadJobs();
        } catch (err) {
          this.byId('deployButton').setEnabled(true);
          this.byId('deployZipButton').setEnabled(true);
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

    // Generate and Deploy ZIP are two different tabs driving the same job/
    // attempts model, so every status/error/max-attempts update is mirrored
    // onto both tabs' controls - whichever one the user is looking at shows
    // the live result.

    _setStatus: function (statusKey, text) {
      const state = STATUS_STATE[statusKey] || 'None';

      ['statusText', 'zipStatusText'].forEach((id) => {
        this.byId(id).setText(text);
        this.byId(id).setState(state);
      });
      ['statusBusy', 'zipStatusBusy'].forEach((id) => {
        this.byId(id).setVisible(statusKey === 'RUNNING');
      });
    },

    _showError: function (message) {
      ['errorStrip', 'zipErrorStrip'].forEach((id) => {
        const strip = this.byId(id);
        strip.setText(message);
        strip.setVisible(true);
      });
    },

    _hideError: function () {
      ['errorStrip', 'zipErrorStrip'].forEach((id) => this.byId(id).setVisible(false));
    },

    _showMaxAttempts: function () {
      ['maxAttemptsStrip', 'zipMaxAttemptsStrip'].forEach((id) => this.byId(id).setVisible(true));
    },

    _hideMaxAttempts: function () {
      ['maxAttemptsStrip', 'zipMaxAttemptsStrip'].forEach((id) => this.byId(id).setVisible(false));
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
